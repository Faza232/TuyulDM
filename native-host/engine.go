package main

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"errors"
	"fmt"
	"hash"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	defaultSegments   = 8
	maxRedirects      = 10
	maxSegmentRetries = 5
)

var forwardedHeaderAllowlist = map[string]struct{}{
	"Authorization": {},
	"Cookie":        {},
	"Origin":        {},
	"Referer":       {},
	"User-Agent":    {},
}

type DownloadRequest struct {
	URL      string            `json:"url"`
	Filename string            `json:"filename"`
	Segments int               `json:"segments"`
	Headers  map[string]string `json:"headers,omitempty"`
	Cookies  []RequestCookie   `json:"cookies,omitempty"`
	Schedule *DownloadSchedule `json:"schedule,omitempty"`
}

type downloadMetadata struct {
	FinalURL     string
	TotalSize    int64
	AcceptRanges bool
	ContentMD5   string
	Digest       string
}

type retryableStatusError struct {
	StatusCode int
	RetryAfter time.Duration
}

func (e *retryableStatusError) Error() string {
	return fmt.Sprintf("retryable status %d", e.StatusCode)
}

type statusCodeError struct {
	StatusCode int
	Message    string
}

func (e *statusCodeError) Error() string {
	return fmt.Sprintf("%s %d", strings.TrimSpace(e.Message), e.StatusCode)
}

type codedError struct {
	Code string
	Err  error
}

func (e *codedError) Error() string {
	if e.Err == nil {
		return e.Code
	}
	return e.Err.Error()
}

func (e *codedError) Unwrap() error {
	return e.Err
}

func withErrorCode(code string, err error) error {
	if err == nil {
		return nil
	}
	return &codedError{Code: code, Err: err}
}

func clearDownloadFailureState(state *DownloadState) {
	state.Error = ""
	state.ErrorCode = ""
	state.LastAttemptAt = time.Time{}
}

func noteDownloadAttempt(state *DownloadState, err error) {
	state.ErrorCode = downloadErrorCode(err)
	state.LastAttemptAt = time.Now().UTC()
}

func setDownloadFailureState(state *DownloadState, err error) {
	state.Status = "error"
	state.Speed = "0 B/s"
	state.Error = err.Error()
	noteDownloadAttempt(state, err)
}

func downloadErrorCode(err error) string {
	if err == nil {
		return ""
	}

	var coded *codedError
	if errors.As(err, &coded) && strings.TrimSpace(coded.Code) != "" {
		return coded.Code
	}

	var retryErr *retryableStatusError
	if errors.As(err, &retryErr) {
		return strconv.Itoa(retryErr.StatusCode)
	}

	var statusErr *statusCodeError
	if errors.As(err, &statusErr) {
		return strconv.Itoa(statusErr.StatusCode)
	}

	if errors.Is(err, io.ErrUnexpectedEOF) {
		return "unexpected_eof"
	}

	return "download_failed"
}

func (e *Engine) recordRetryableAttempt(a *ActiveDownload, idx int, requestURL string, attempt int, retryErr *retryableStatusError, event string) {
	a.mu.Lock()
	noteDownloadAttempt(a.State, retryErr)
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	e.persistSnapshot(snapshot)
	slog.Warn(event,
		"download_id", snapshot.ID,
		"url", requestURL,
		"attempt", attempt,
		"segment_index", idx,
		"retryable_status", retryErr.StatusCode,
		"retry_after_ms", retryErr.RetryAfter.Milliseconds(),
	)
}

type Engine struct {
	storage       *Storage
	active        map[string]*ActiveDownload
	queued        []string
	queuedSet     map[string]struct{}
	slotPool      chan struct{}
	settings      HostSettings
	globalLimiter *rate.Limiter
	onProgress    func(DownloadState)
	mu            sync.Mutex
}

type ActiveDownload struct {
	State              *DownloadState
	Ctx                context.Context
	Cancel             context.CancelFunc
	File               *os.File
	PerDownloadLimiter *rate.Limiter
	mu                 sync.Mutex
}

func NewEngine(s *Storage, onProgress func(DownloadState)) *Engine {
	settings, err := s.GetHostSettings()
	if err != nil {
		settings = defaultHostSettings()
	}
	normalizedSettings := normalizeHostSettings(settings)

	engine := &Engine{
		storage:       s,
		active:        make(map[string]*ActiveDownload),
		queuedSet:     make(map[string]struct{}),
		slotPool:      make(chan struct{}, maxConcurrentDownloadsLimit),
		settings:      normalizedSettings,
		globalLimiter: newRateLimiter(normalizedSettings.GlobalThrottleBytesPerSecond),
		onProgress:    onProgress,
	}
	engine.rebalanceSlotPoolLocked()
	return engine
}

func (e *Engine) HostSettings() HostSettings {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.settings
}

func (e *Engine) UpdateHostSettings(settings HostSettings) error {
	normalizedSettings, err := validateHostSettingsUpdate(settings)
	if err != nil {
		return err
	}
	if err := e.storage.SaveHostSettings(normalizedSettings); err != nil {
		return err
	}

	e.mu.Lock()
	e.settings = normalizedSettings
	e.globalLimiter = newRateLimiter(normalizedSettings.GlobalThrottleBytesPerSecond)
	for _, active := range e.active {
		active.mu.Lock()
		active.PerDownloadLimiter = newRateLimiter(normalizedSettings.PerDownloadThrottleBytesPerSecond)
		active.mu.Unlock()
	}
	e.rebalanceSlotPoolLocked()
	e.mu.Unlock()

	e.drainQueue()
	return nil
}

func (e *Engine) hostSettingsSnapshot() HostSettings {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.settings
}

func (e *Engine) globalLimiterSnapshot() *rate.Limiter {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.globalLimiter
}

func (e *Engine) Add(req DownloadRequest) (*DownloadState, error) {
	if strings.TrimSpace(req.URL) == "" {
		return nil, fmt.Errorf("url is required")
	}

	headers := sanitizeRequestHeaders(req.Headers)
	cookies := sanitizeRequestCookies(req.Cookies)
	metadata, err := e.probeDownload(req.URL, headers, cookies)
	if err != nil {
		return nil, err
	}

	filename, outputPath, err := e.resolveDownloadTarget(metadata.FinalURL, req.Filename)
	if err != nil {
		return nil, err
	}

	id := fmt.Sprintf("%d%d", os.Getpid(), time.Now().UnixNano())
	state := &DownloadState{
		ID:         id,
		URL:        metadata.FinalURL,
		Filename:   filename,
		OutputPath: outputPath,
		TotalSize:  metadata.TotalSize,
		Status:     "queued",
		Type:       "file",
		CreatedAt:  time.Now(),
		Headers:    headers,
		Cookies:    cookies,
		ContentMD5: metadata.ContentMD5,
		Digest:     metadata.Digest,
		Segments:   buildSegments(metadata.TotalSize, req.Segments, metadata.AcceptRanges),
		Schedule:   cloneDownloadSchedule(req.Schedule),
	}

	if err := e.storage.SaveDownload(state); err != nil {
		return nil, err
	}

	return state, nil
}

func (e *Engine) Start(id string) error {
	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	e.mu.Lock()
	if _, ok := e.active[id]; ok {
		e.mu.Unlock()
		return fmt.Errorf("already active")
	}
	e.mu.Unlock()

	state.Status = "queued"
	clearDownloadFailureState(state)
	state.Speed = "0 B/s"
	state.WasUserPaused = false
	if err := e.storage.SaveDownload(state); err != nil {
		return err
	}

	e.mu.Lock()
	if _, ok := e.active[id]; ok {
		e.mu.Unlock()
		return fmt.Errorf("already active")
	}
	if _, ok := e.queuedSet[id]; !ok {
		e.queued = append(e.queued, id)
		e.queuedSet[id] = struct{}{}
	}
	e.mu.Unlock()

	e.drainQueue()
	return nil
}

func (e *Engine) runDownload(a *ActiveDownload) {
	file, err := os.OpenFile(downloadPath(a.State), os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		e.failDownload(a, err)
		return
	}
	a.File = file
	defer func() {
		_ = file.Close()
	}()

	if a.State.TotalSize > 0 {
		if err := file.Truncate(a.State.TotalSize); err != nil {
			e.failDownload(a, err)
			return
		}
	}

	var wg sync.WaitGroup
	var lastError error

	for i := range a.State.Segments {
		if a.State.Segments[i].Completed {
			continue
		}
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if err := e.downloadSegment(a, idx); err != nil && !errors.Is(err, context.Canceled) {
				a.mu.Lock()
				if lastError == nil {
					lastError = err
					a.Cancel()
				}
				a.mu.Unlock()
			}
		}(i)
	}

	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		var lastBytes int64
		for {
			select {
			case <-ticker.C:
				snapshot := func() DownloadState {
					a.mu.Lock()
					defer a.mu.Unlock()

					currentBytes := downloadedBytes(a.State)
					diff := currentBytes - lastBytes
					lastBytes = currentBytes

					if a.State.TotalSize > 0 {
						a.State.Progress = float64(currentBytes) / float64(a.State.TotalSize) * 100
					} else {
						a.State.Progress = 0
					}
					a.State.Speed = formatSpeed(diff * 2)
					return cloneDownloadState(a.State)
				}()

				e.persistSnapshot(snapshot)
			case <-done:
				return
			case <-a.Ctx.Done():
				return
			}
		}
	}()

	wg.Wait()
	close(done)
	_ = file.Sync()

	e.releaseActiveSlot(a.State.ID)

	a.mu.Lock()
	allDone := allSegmentsCompleted(a.State)
	if lastError != nil {
		setDownloadFailureState(a.State, lastError)
	} else if allDone {
		if a.State.TotalSize <= 0 {
			a.State.TotalSize = downloadedBytes(a.State)
		}
		if err := verifyDownloadIntegrity(a.State); err != nil {
			err = withErrorCode("integrity_check_failed", err)
			slog.Error("download integrity check failed",
				"download_id", a.State.ID,
				"url", a.State.URL,
				"output_path", downloadPath(a.State),
				"error", err,
			)
			setDownloadFailureState(a.State, err)
		} else {
			a.State.Status = "finished"
			a.State.Progress = 100
			a.State.Speed = "0 B/s"
			clearDownloadFailureState(a.State)
		}
	} else {
		a.State.Status = "paused"
		a.State.Speed = "0 B/s"
	}
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	e.persistSnapshot(snapshot)
}

func formatSpeed(bytesPerSec int64) string {
	const unit = 1024
	if bytesPerSec < unit {
		return fmt.Sprintf("%d B/s", bytesPerSec)
	}
	div, exp := int64(unit), 0
	for n := bytesPerSec / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB/s", float64(bytesPerSec)/float64(div), "KMGTPE"[exp])
}

func (e *Engine) downloadSegment(a *ActiveDownload, idx int) error {
	for attempt := 0; attempt < maxSegmentRetries; attempt++ {
		err := e.downloadSegmentAttempt(a, idx)
		if err == nil {
			return nil
		}

		var retryErr *retryableStatusError
		if errors.As(err, &retryErr) {
			a.mu.Lock()
			downloadID := a.State.ID
			requestURL := a.State.URL
			a.mu.Unlock()
			e.recordRetryableAttempt(a, idx, requestURL, attempt+1, retryErr, "segment retry scheduled")
			if attempt == maxSegmentRetries-1 {
				finalErr := withErrorCode(downloadErrorCode(err), fmt.Errorf("segment %d exhausted retries: %w", idx, err))
				slog.Error("segment exhausted retries",
					"download_id", downloadID,
					"url", requestURL,
					"attempt", attempt+1,
					"segment_index", idx,
					"retryable_status", retryErr.StatusCode,
					"retry_after_ms", retryErr.RetryAfter.Milliseconds(),
				)
				return finalErr
			}
			if waitErr := waitForRetry(a.Ctx, retryErr.RetryAfter); waitErr != nil {
				return waitErr
			}
			continue
		}

		return err
	}

	return withErrorCode("download_failed", fmt.Errorf("segment %d exhausted retries", idx))
}

func (e *Engine) downloadSegmentAttempt(a *ActiveDownload, idx int) error {
	a.mu.Lock()
	seg := a.State.Segments[idx]
	downloadID := a.State.ID
	stateURL := a.State.URL
	headers := cloneStringMap(a.State.Headers)
	cookies := append([]RequestCookie(nil), a.State.Cookies...)
	segmentCount := len(a.State.Segments)
	perDownloadLimiter := a.PerDownloadLimiter
	a.mu.Unlock()

	startOffset := seg.Start + seg.Current
	if seg.End >= 0 && startOffset > seg.End {
		return e.completeSegment(a, idx)
	}

	client, err := newHTTPClient(stateURL, cookies, true)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(a.Ctx, http.MethodGet, stateURL, nil)
	if err != nil {
		return err
	}
	applyRequestHeaders(req, headers, cookies)

	rangeRequested := false
	switch {
	case seg.End >= 0 && (segmentCount > 1 || seg.Current > 0):
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", startOffset, seg.End))
		rangeRequested = true
	case seg.End < 0 && seg.Current > 0:
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", startOffset))
		rangeRequested = true
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	reader := newThrottledReader(a.Ctx, resp.Body, perDownloadLimiter, e.globalLimiterSnapshot())

	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
		return &retryableStatusError{StatusCode: resp.StatusCode, RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After"))}
	}

	switch {
	case rangeRequested && resp.StatusCode != http.StatusPartialContent:
		err := &statusCodeError{StatusCode: resp.StatusCode, Message: "range request returned status"}
		slog.Error("segment range request failed",
			"download_id", downloadID,
			"url", stateURL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	case !rangeRequested && resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent:
		err := &statusCodeError{StatusCode: resp.StatusCode, Message: "unexpected status code"}
		slog.Error("segment request failed",
			"download_id", downloadID,
			"url", stateURL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	}

	writeOffset := startOffset
	buf := make([]byte, 32*1024)
	for {
		n, readErr := reader.Read(buf)
		if n > 0 {
			written, writeErr := a.File.WriteAt(buf[:n], writeOffset)
			if writeErr != nil {
				return writeErr
			}
			if written != n {
				return io.ErrShortWrite
			}

			writeOffset += int64(n)
			a.mu.Lock()
			a.State.Segments[idx].Current += int64(n)
			a.mu.Unlock()
		}

		if readErr != nil {
			if readErr == io.EOF {
				return e.completeSegment(a, idx)
			}
			return readErr
		}
	}
}

func (e *Engine) completeSegment(a *ActiveDownload, idx int) error {
	a.mu.Lock()
	seg := &a.State.Segments[idx]
	if seg.End >= 0 {
		expected := seg.End - seg.Start + 1
		if seg.Current < expected {
			a.mu.Unlock()
			return io.ErrUnexpectedEOF
		}
	}
	seg.Completed = true
	if a.State.TotalSize <= 0 && len(a.State.Segments) == 1 && seg.End < 0 {
		a.State.TotalSize = seg.Current
	}
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	e.persistSnapshot(snapshot)
	return nil
}

func (e *Engine) Pause(id string) error {
	return e.pause(id, true)
}

func (e *Engine) pauseSystem(id string) error {
	return e.pause(id, false)
}

func (e *Engine) pause(id string, userInitiated bool) error {
	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	if state.Status == "finished" || state.Status == "error" {
		return nil
	}

	state.Status = "paused"
	state.Speed = "0 B/s"
	state.WasUserPaused = userInitiated

	e.mu.Lock()
	var cancel context.CancelFunc
	if _, ok := e.queuedSet[id]; ok {
		delete(e.queuedSet, id)
		for index, queuedID := range e.queued {
			if queuedID == id {
				e.queued = append(e.queued[:index], e.queued[index+1:]...)
				break
			}
		}
	}
	if a, ok := e.active[id]; ok {
		a.mu.Lock()
		a.State.Status = "paused"
		a.State.Speed = "0 B/s"
		a.State.WasUserPaused = userInitiated
		a.mu.Unlock()
		cancel = a.Cancel
	}
	e.mu.Unlock()

	if err := e.storage.SaveDownload(state); err != nil {
		return err
	}

	if cancel != nil {
		cancel()
	}

	return nil
}

func (e *Engine) Resume(id string) error {
	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	state.WasUserPaused = false
	if err := e.storage.SaveDownload(state); err != nil {
		return err
	}

	return e.Start(id)
}

func (e *Engine) probeDownload(downloadURL string, headers map[string]string, cookies []RequestCookie) (downloadMetadata, error) {
	headResp, finalURL, err := doRequestWithRedirects(context.Background(), http.MethodHead, downloadURL, headers, cookies, nil)
	if err != nil {
		slog.Warn("download probe head request failed", "url", downloadURL, "error", err)
		return downloadMetadata{}, err
	}

	headMeta := metadataFromResponse(finalURL, headResp)
	headStatus := headResp.StatusCode
	_ = headResp.Body.Close()

	if headStatus == http.StatusOK && headMeta.TotalSize > 0 && headMeta.AcceptRanges {
		return headMeta, nil
	}

	rangeResp, rangeURL, rangeErr := doRequestWithRedirects(context.Background(), http.MethodGet, finalURL, headers, cookies, func(req *http.Request) {
		req.Header.Set("Range", "bytes=0-0")
	})
	if rangeErr != nil {
		if headStatus == http.StatusOK && headMeta.TotalSize > 0 {
			return headMeta, nil
		}
		slog.Warn("download probe fallback request failed",
			"url", finalURL,
			"head_status_code", headStatus,
			"error", rangeErr,
		)
		return downloadMetadata{}, rangeErr
	}
	defer rangeResp.Body.Close()

	rangeMeta := metadataFromResponse(rangeURL, rangeResp)
	switch rangeResp.StatusCode {
	case http.StatusPartialContent, http.StatusOK:
		if rangeMeta.ContentMD5 == "" {
			rangeMeta.ContentMD5 = headMeta.ContentMD5
		}
		if rangeMeta.Digest == "" {
			rangeMeta.Digest = headMeta.Digest
		}
		return rangeMeta, nil
	default:
		if headStatus == http.StatusOK && headMeta.TotalSize > 0 {
			return headMeta, nil
		}
		err := &statusCodeError{StatusCode: rangeResp.StatusCode, Message: "metadata probe returned status"}
		slog.Warn("download probe rejected",
			"url", rangeURL,
			"head_status_code", headStatus,
			"status_code", rangeResp.StatusCode,
		)
		return downloadMetadata{}, err
	}
}

func doRequestWithRedirects(ctx context.Context, method string, startURL string, headers map[string]string, cookies []RequestCookie, configure func(*http.Request)) (*http.Response, string, error) {
	client, err := newHTTPClient(startURL, cookies, false)
	if err != nil {
		return nil, startURL, err
	}

	currentURL := startURL
	for redirects := 0; redirects <= maxRedirects; redirects++ {
		req, err := http.NewRequestWithContext(ctx, method, currentURL, nil)
		if err != nil {
			return nil, currentURL, err
		}
		applyRequestHeaders(req, headers, cookies)
		if configure != nil {
			configure(req)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, currentURL, err
		}

		if !isRedirectStatus(resp.StatusCode) {
			return resp, currentURL, nil
		}

		location := resp.Header.Get("Location")
		_ = resp.Body.Close()
		if strings.TrimSpace(location) == "" {
			return nil, currentURL, fmt.Errorf("redirect missing location header")
		}

		nextURL, err := resolveRedirectURL(currentURL, location)
		if err != nil {
			return nil, currentURL, err
		}
		currentURL = nextURL
	}

	return nil, currentURL, fmt.Errorf("too many redirects")
}

func newHTTPClient(rawURL string, cookies []RequestCookie, followRedirects bool) (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}

	if len(cookies) > 0 {
		parsedURL, err := url.Parse(rawURL)
		if err == nil {
			jarCookies := make([]*http.Cookie, 0, len(cookies))
			for _, cookie := range cookies {
				jarCookies = append(jarCookies, cookie.toHTTPCookie())
			}
			jar.SetCookies(parsedURL, jarCookies)
		}
	}

	client := &http.Client{Jar: jar}
	if !followRedirects {
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}

	return client, nil
}

func applyRequestHeaders(req *http.Request, headers map[string]string, cookies []RequestCookie) {
	for name, value := range headers {
		if name == "Cookie" && len(cookies) > 0 {
			continue
		}
		req.Header.Set(name, value)
	}

	if len(cookies) == 0 {
		return
	}

	for _, cookie := range cookies {
		req.AddCookie(cookie.toHTTPCookie())
	}
}

func metadataFromResponse(finalURL string, resp *http.Response) downloadMetadata {
	totalSize := resp.ContentLength
	acceptRanges := strings.EqualFold(resp.Header.Get("Accept-Ranges"), "bytes")
	if resp.StatusCode == http.StatusPartialContent {
		if parsedSize, err := parseContentRangeTotal(resp.Header.Get("Content-Range")); err == nil && parsedSize > 0 {
			totalSize = parsedSize
		}
		acceptRanges = true
	}

	return downloadMetadata{
		FinalURL:     finalURL,
		TotalSize:    totalSize,
		AcceptRanges: acceptRanges,
		ContentMD5:   strings.TrimSpace(resp.Header.Get("Content-MD5")),
		Digest:       strings.TrimSpace(resp.Header.Get("Digest")),
	}
}

func parseContentRangeTotal(contentRange string) (int64, error) {
	parts := strings.Split(strings.TrimSpace(contentRange), "/")
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid content-range %q", contentRange)
	}
	if parts[1] == "*" {
		return 0, fmt.Errorf("unknown total size")
	}
	var total int64
	_, err := fmt.Sscanf(parts[1], "%d", &total)
	if err != nil {
		return 0, err
	}
	return total, nil
}

func isRedirectStatus(statusCode int) bool {
	switch statusCode {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	default:
		return false
	}
}

func resolveRedirectURL(currentURL string, location string) (string, error) {
	baseURL, err := url.Parse(currentURL)
	if err != nil {
		return "", err
	}
	locationURL, err := url.Parse(location)
	if err != nil {
		return "", err
	}
	return baseURL.ResolveReference(locationURL).String(), nil
}

func waitForRetry(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		duration = time.Second
	}

	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func parseRetryAfter(value string) time.Duration {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Second
	}

	if seconds, err := time.ParseDuration(trimmed + "s"); err == nil {
		return seconds
	}

	if retryAt, err := http.ParseTime(trimmed); err == nil {
		return time.Until(retryAt)
	}

	return time.Second
}

func buildSegments(totalSize int64, requestedSegments int, canSegment bool) []Segment {
	if totalSize <= 0 {
		return []Segment{{Index: 0, Start: 0, End: -1}}
	}

	if requestedSegments <= 0 {
		requestedSegments = defaultSegments
	}
	if !canSegment {
		requestedSegments = 1
	}
	if totalSize < int64(requestedSegments) {
		requestedSegments = int(totalSize)
		if requestedSegments < 1 {
			requestedSegments = 1
		}
	}

	segments := make([]Segment, 0, requestedSegments)
	baseSize := totalSize / int64(requestedSegments)
	remainder := totalSize % int64(requestedSegments)
	start := int64(0)
	for i := 0; i < requestedSegments; i++ {
		length := baseSize
		if int64(i) < remainder {
			length++
		}
		end := start + length - 1
		segments = append(segments, Segment{Index: i, Start: start, End: end})
		start = end + 1
	}

	return segments
}

func (e *Engine) resolveDownloadTarget(downloadURL string, requestedName string) (string, string, error) {
	downloadsDir, err := ResolveDownloadDir(e.HostSettings())
	if err != nil {
		return "", "", err
	}
	return resolveDownloadTarget(downloadURL, requestedName, downloadsDir)
}

func resolveDownloadTarget(downloadURL string, requestedName string, downloadsDir string) (string, string, error) {
	filename := strings.TrimSpace(filepath.Base(requestedName))
	if filename == "" || filename == "." || filename == string(filepath.Separator) {
		filename = filenameFromURL(downloadURL)
	}

	return filename, filepath.Join(downloadsDir, filename), nil
}

func filenameFromURL(rawURL string) string {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Sprintf("Download_%d", time.Now().Unix())
	}

	name := path.Base(parsedURL.Path)
	if name == "" || name == "/" || name == "." {
		return fmt.Sprintf("Download_%d", time.Now().Unix())
	}
	return name
}

func sanitizeRequestHeaders(headers map[string]string) map[string]string {
	if len(headers) == 0 {
		return nil
	}

	clean := make(map[string]string)
	for name, value := range headers {
		canonicalName := http.CanonicalHeaderKey(strings.TrimSpace(name))
		if _, ok := forwardedHeaderAllowlist[canonicalName]; !ok {
			continue
		}
		trimmedValue := strings.TrimSpace(value)
		if trimmedValue == "" {
			continue
		}
		clean[canonicalName] = trimmedValue
	}

	if len(clean) == 0 {
		return nil
	}
	return clean
}

func sanitizeRequestCookies(cookies []RequestCookie) []RequestCookie {
	if len(cookies) == 0 {
		return nil
	}

	clean := make([]RequestCookie, 0, len(cookies))
	for _, cookie := range cookies {
		name := strings.TrimSpace(cookie.Name)
		if name == "" {
			continue
		}
		clean = append(clean, RequestCookie{
			Name:   name,
			Value:  cookie.Value,
			Domain: strings.TrimSpace(cookie.Domain),
			Path:   cookie.normalizedPath(),
		})
	}

	if len(clean) == 0 {
		return nil
	}
	return clean
}

func downloadedBytes(state *DownloadState) int64 {
	var total int64
	for _, segment := range state.Segments {
		total += segment.Current
	}
	return total
}

func allSegmentsCompleted(state *DownloadState) bool {
	for _, segment := range state.Segments {
		if !segment.Completed {
			return false
		}
	}
	return true
}

func verifyDownloadIntegrity(state *DownloadState) error {
	if state.TotalSize > 0 {
		var expected int64
		for _, segment := range state.Segments {
			if segment.End < segment.Start {
				continue
			}
			expected += segment.End - segment.Start + 1
		}
		if expected > 0 && expected != state.TotalSize {
			return fmt.Errorf("segment size mismatch: expected %d, got %d", state.TotalSize, expected)
		}

		info, err := os.Stat(downloadPath(state))
		if err != nil {
			return err
		}
		if info.Size() != state.TotalSize {
			return fmt.Errorf("downloaded file size mismatch: expected %d, got %d", state.TotalSize, info.Size())
		}
	}

	if state.ContentMD5 != "" {
		if err := verifyFileHash(downloadPath(state), md5.New(), state.ContentMD5); err != nil {
			return fmt.Errorf("content-md5 mismatch: %w", err)
		}
	}

	if state.Digest != "" {
		if err := verifyDigestHeader(downloadPath(state), state.Digest); err != nil {
			return err
		}
	}

	return nil
}

func verifyFileHash(path string, hasher hash.Hash, expectedBase64 string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := io.Copy(hasher, file); err != nil {
		return err
	}

	actual := base64.StdEncoding.EncodeToString(hasher.Sum(nil))
	if actual != strings.TrimSpace(expectedBase64) {
		return fmt.Errorf("expected %s, got %s", expectedBase64, actual)
	}
	return nil
}

func verifyDigestHeader(path string, digestHeader string) error {
	entries := strings.Split(digestHeader, ",")
	verifiedAny := false
	for _, entry := range entries {
		name, value, ok := strings.Cut(strings.TrimSpace(entry), "=")
		if !ok {
			continue
		}
		algorithm := strings.ToLower(strings.TrimSpace(name))
		expected := strings.Trim(strings.TrimSpace(value), `"`)

		switch algorithm {
		case "md5":
			if err := verifyFileHash(path, md5.New(), expected); err != nil {
				return fmt.Errorf("digest md5 mismatch: %w", err)
			}
			verifiedAny = true
		case "sha-256":
			if err := verifyFileHash(path, sha256.New(), expected); err != nil {
				return fmt.Errorf("digest sha-256 mismatch: %w", err)
			}
			verifiedAny = true
		case "sha-512":
			if err := verifyFileHash(path, sha512.New(), expected); err != nil {
				return fmt.Errorf("digest sha-512 mismatch: %w", err)
			}
			verifiedAny = true
		}
	}

	if !verifiedAny {
		return nil
	}
	return nil
}

func downloadPath(state *DownloadState) string {
	if strings.TrimSpace(state.OutputPath) != "" {
		return state.OutputPath
	}
	return state.Filename
}

func (e *Engine) persistSnapshot(snapshot DownloadState) {
	_ = e.storage.SaveDownload(&snapshot)
	if e.onProgress != nil {
		e.onProgress(snapshot)
	}
}

func (e *Engine) failDownload(a *ActiveDownload, err error) {
	e.releaseActiveSlot(a.State.ID)

	a.mu.Lock()
	setDownloadFailureState(a.State, err)
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	slog.Error("download failed",
		"download_id", snapshot.ID,
		"url", snapshot.URL,
		"error", err,
		"error_code", snapshot.ErrorCode,
	)
	e.persistSnapshot(snapshot)
}

func cloneDownloadState(state *DownloadState) DownloadState {
	clone := *state
	clone.Headers = cloneStringMap(state.Headers)
	clone.Cookies = append([]RequestCookie(nil), state.Cookies...)
	clone.Variants = append([]VideoVariant(nil), state.Variants...)
	clone.Segments = append([]Segment(nil), state.Segments...)
	clone.Schedule = cloneDownloadSchedule(state.Schedule)
	return clone
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	clone := make(map[string]string, len(values))
	for key, value := range values {
		clone[key] = value
	}
	return clone
}

func (e *Engine) rebalanceSlotPoolLocked() {
	target := normalizeHostSettings(e.settings).MaxConcurrentDownloads
	for len(e.slotPool)+len(e.active) < target {
		e.slotPool <- struct{}{}
	}
	for len(e.slotPool) > 0 && len(e.slotPool)+len(e.active) > target {
		<-e.slotPool
	}
}

func (e *Engine) drainQueue() {
	for {
		e.mu.Lock()
		if len(e.queued) == 0 {
			e.mu.Unlock()
			return
		}

		select {
		case <-e.slotPool:
		default:
			e.mu.Unlock()
			return
		}

		id := e.queued[0]
		e.queued = e.queued[1:]
		delete(e.queuedSet, id)
		e.mu.Unlock()

		if err := e.startQueuedDownload(id); err != nil {
			e.returnAvailableSlot()
		}
	}
}

func (e *Engine) startQueuedDownload(id string) error {
	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	settings := e.hostSettingsSnapshot()
	active := &ActiveDownload{
		State:              state,
		Ctx:                ctx,
		Cancel:             cancel,
		PerDownloadLimiter: newRateLimiter(settings.PerDownloadThrottleBytesPerSecond),
	}

	e.mu.Lock()
	if _, ok := e.active[id]; ok {
		e.mu.Unlock()
		cancel()
		return fmt.Errorf("already active")
	}
	e.active[id] = active
	e.mu.Unlock()

	state.Status = "downloading"
	state.Error = ""
	state.Speed = "0 B/s"
	if err := e.storage.SaveDownload(state); err != nil {
		e.mu.Lock()
		delete(e.active, id)
		e.mu.Unlock()
		cancel()
		return err
	}

	if state.Type == "video" {
		go e.runVideoDownload(active)
	} else {
		go e.runDownload(active)
	}

	return nil
}

func (e *Engine) releaseActiveSlot(id string) {
	e.mu.Lock()
	delete(e.active, id)
	e.returnAvailableSlotLocked()
	e.mu.Unlock()
	e.drainQueue()
}

func (e *Engine) returnAvailableSlot() {
	e.mu.Lock()
	e.returnAvailableSlotLocked()
	e.mu.Unlock()
}

func (e *Engine) returnAvailableSlotLocked() {
	target := normalizeHostSettings(e.settings).MaxConcurrentDownloads
	if len(e.slotPool)+len(e.active) < target {
		e.slotPool <- struct{}{}
	}
}
