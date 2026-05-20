package main

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptrace"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"
)

const (
	defaultSegments            = 8
	maxRedirects               = 10
	maxSegmentRetries          = 5
	segmentSplitThresholdBytes = 4 * 1024 * 1024
)

var forwardedHeaderAllowlist = map[string]struct{}{
	"Authorization": {},
	"Cookie":        {},
	"Origin":        {},
	"Referer":       {},
	"User-Agent":    {},
}

type DownloadRequest struct {
	ID       string            `json:"id,omitempty"`
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
	ETag         string
	LastModified string
}

func (m downloadMetadata) hasValidators() bool {
	return m.ETag != "" || m.LastModified != ""
}

func mergeProbeMetadata(primary downloadMetadata, fallback downloadMetadata) downloadMetadata {
	if primary.ContentMD5 == "" {
		primary.ContentMD5 = fallback.ContentMD5
	}
	if primary.Digest == "" {
		primary.Digest = fallback.Digest
	}
	if primary.ETag == "" {
		primary.ETag = fallback.ETag
	}
	if primary.LastModified == "" {
		primary.LastModified = fallback.LastModified
	}
	return primary
}

type retryableStatusError struct {
	StatusCode     int
	RetryAfter     time.Duration
	UsedRetryAfter bool
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
	Code    string
	Payload interface{}
	Err     error
}

type rangeResumeResetError struct {
	SegmentIndex int
}

func (e *rangeResumeResetError) Error() string {
	return fmt.Sprintf("segment %d resume offset past eof", e.SegmentIndex)
}

type remoteChangeRecoveryError struct {
	SegmentIndex  int
	ContentLength int64
}

type urlExpiredError struct {
	SegmentIndex int
	StatusCode   int
	Reason       string
}

type integrityMismatchError struct {
	Algorithm string
	Expected  string
	Actual    string
}

type integritySkippedError struct {
	Reason string
}

func (e *remoteChangeRecoveryError) Error() string {
	return fmt.Sprintf("segment %d remote changed during resume", e.SegmentIndex)
}

func (e *urlExpiredError) Error() string {
	if strings.TrimSpace(e.Reason) != "" {
		return e.Reason
	}
	return fmt.Sprintf("segment %d download link expired", e.SegmentIndex)
}

func (e *integrityMismatchError) Error() string {
	if e == nil {
		return "integrity mismatch"
	}
	return fmt.Sprintf("%s mismatch: expected %s, got %s", e.Algorithm, e.Expected, e.Actual)
}

func (e *integritySkippedError) Error() string {
	if e == nil || strings.TrimSpace(e.Reason) == "" {
		return "integrity skipped"
	}
	return fmt.Sprintf("integrity skipped: %s", e.Reason)
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
	return withErrorPayload(code, nil, err)
}

func withErrorPayload(code string, payload interface{}, err error) error {
	if err == nil {
		return nil
	}
	return &codedError{Code: code, Payload: payload, Err: err}
}

func preferredResumeValidator(state *DownloadState) string {
	if state == nil {
		return ""
	}
	if state.ETag != "" {
		return state.ETag
	}
	return state.LastModified
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
	setDownloadSpeed(state, 0)
	state.Error = err.Error()
	noteDownloadAttempt(state, err)
}

func setDownloadAwaitingURLRefresh(state *DownloadState, message string) {
	state.Status = "awaiting_url_refresh"
	setDownloadSpeed(state, 0)
	state.Error = message
	state.ErrorCode = "url_expired"
	state.LastAttemptAt = time.Now().UTC()
}

func setDownloadSpeed(state *DownloadState, bytesPerSecond int64) {
	if bytesPerSecond < 0 {
		bytesPerSecond = 0
	}
	state.SpeedBytesPerSecond = bytesPerSecond
	state.Speed = formatSpeed(bytesPerSecond)
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

func statusAllowsURLRefresh(state *DownloadState) bool {
	if state == nil {
		return false
	}
	if state.Status == "awaiting_url_refresh" || state.Status == "paused" {
		return true
	}
	return state.Status == "error" && state.ErrorCode == "url_expired"
}

func refreshURLExpectedSize(state *DownloadState) int64 {
	if state == nil {
		return 0
	}
	if state.TotalSizeAtAdd > 0 {
		return state.TotalSizeAtAdd
	}
	return state.TotalSize
}

func requestedSegmentsForState(state *DownloadState) int {
	if state == nil || len(state.Segments) == 0 {
		return defaultSegments
	}
	return len(state.Segments)
}

func isHTMLAssetResponse(stateURL string, resp *http.Response, rangeRequested bool) bool {
	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if !strings.Contains(contentType, "text/html") {
		return false
	}
	if rangeRequested {
		return true
	}
	lowerURL := strings.ToLower(strings.TrimSpace(stateURL))
	return !strings.HasSuffix(lowerURL, ".html") && !strings.HasSuffix(lowerURL, ".htm")
}

func segmentRetryLogAttrs(snapshot DownloadState, idx int, requestURL string, attempt int, err error, delay time.Duration) []any {
	attrs := []any{
		"download_id", snapshot.ID,
		"url", requestURL,
		"attempt", attempt,
		"segment_index", idx,
		"event", "segment_retry",
		"delay_ms", delay.Milliseconds(),
	}

	var retryErr *retryableStatusError
	if errors.As(err, &retryErr) {
		attrs = append(attrs, "retryable_status", retryErr.StatusCode)
		if retryErr.UsedRetryAfter {
			attrs = append(attrs, "retry_after_ms", retryErr.RetryAfter.Milliseconds())
		}
		return attrs
	}

	return append(attrs, "network_error", err.Error())
}

func (e *Engine) recordSegmentRetryAttempt(a *ActiveDownload, idx int, requestURL string, attempt int, err error, delay time.Duration) {
	a.mu.Lock()
	noteDownloadAttempt(a.State, err)
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	e.persistSnapshot(snapshot)
	slog.Warn("segment retry scheduled", segmentRetryLogAttrs(snapshot, idx, requestURL, attempt, err, delay)...)
}

func (e *Engine) recordRetryableAttempt(a *ActiveDownload, idx int, requestURL string, attempt int, retryErr *retryableStatusError, _ string) {
	e.recordSegmentRetryAttempt(a, idx, requestURL, attempt, retryErr, retryErr.RetryAfter)
}

func isRetryableHTTPStatus(statusCode int) bool {
	switch statusCode {
	case http.StatusRequestTimeout, http.StatusTooEarly, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func isFatalHTTPStatus(statusCode int) bool {
	switch statusCode {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusGone, http.StatusUnavailableForLegalReasons:
		return true
	default:
		return false
	}
}

func classifySegmentHTTPError(statusCode int, message string, retryAfterHeader string, attempt int) error {
	if isRetryableHTTPStatus(statusCode) {
		delay, usedRetryAfter := retryDelayFromHeader(retryAfterHeader, attempt)
		return &retryableStatusError{StatusCode: statusCode, RetryAfter: delay, UsedRetryAfter: usedRetryAfter}
	}

	statusErr := &statusCodeError{StatusCode: statusCode, Message: message}
	if isFatalHTTPStatus(statusCode) {
		return withErrorCode(fmt.Sprintf("fatal_http_%d", statusCode), statusErr)
	}
	return statusErr
}

func isRetryableNetworkError(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}

	var coded *codedError
	if errors.As(err, &coded) && coded.Code == "network_stall" {
		return true
	}
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}

	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return true
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}

	return strings.Contains(strings.ToLower(err.Error()), "tls handshake timeout")
}

func retryDelayForSegmentError(err error, attempt int) (time.Duration, bool) {
	var retryErr *retryableStatusError
	if errors.As(err, &retryErr) {
		if retryErr.RetryAfter > 0 {
			return retryErr.RetryAfter, true
		}
		return backoffDelay(attempt), true
	}
	if isRetryableNetworkError(err) {
		return backoffDelay(attempt), true
	}
	return 0, false
}

func resolveRequestContextError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	cause := context.Cause(ctx)
	if cause != nil && !errors.Is(cause, context.Canceled) {
		return cause
	}
	return err
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
	targetMu      sync.Mutex
	shuttingDown  bool
	mu            sync.Mutex
}

type ActiveDownload struct {
	State              *DownloadState
	Ctx                context.Context
	Cancel             context.CancelFunc
	Done               chan struct{}
	File               *os.File
	HTTPClient         *http.Client
	IdleConnections    atomic.Int64
	PerDownloadLimiter atomic.Pointer[rate.Limiter]
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
		active.PerDownloadLimiter.Store(newRateLimiter(normalizedSettings.PerDownloadThrottleBytesPerSecond))
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

func normalizedContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

func (e *Engine) Add(ctx context.Context, req DownloadRequest) (*DownloadState, error) {
	if strings.TrimSpace(req.URL) == "" {
		return nil, fmt.Errorf("url is required")
	}

	headers := sanitizeRequestHeaders(req.Headers)
	cookies := sanitizeRequestCookies(req.Cookies)
	logForwardedCookieContext(req.URL, headers, cookies)
	metadata, err := e.probeDownload(ctx, req.URL, headers, cookies)
	if err != nil {
		return nil, err
	}

	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = fmt.Sprintf("%d%d", os.Getpid(), time.Now().UnixNano())
	}
	probedAt := time.Now().UTC()
	state := &DownloadState{
		ID:             id,
		URL:            metadata.FinalURL,
		TotalSize:      metadata.TotalSize,
		Status:         "queued",
		Type:           "file",
		CreatedAt:      time.Now(),
		Headers:        headers,
		Cookies:        cookies,
		ContentMD5:     metadata.ContentMD5,
		Digest:         metadata.Digest,
		ETag:           metadata.ETag,
		LastModified:   metadata.LastModified,
		TotalSizeAtAdd: metadata.TotalSize,
		ProbedAt:       probedAt,
		Segments:       buildSegments(metadata.TotalSize, clampRequestedSegments(req.Segments, e.hostSettingsSnapshot().MaxSegmentsPerDownload), metadata.AcceptRanges),
		Schedule:       cloneDownloadSchedule(req.Schedule),
	}

	if err := e.assignDownloadTargetAndSave(state, req.Filename); err != nil {
		return nil, err
	}
	if !metadata.hasValidators() {
		slog.Warn("download probe missing validators",
			"download_id", state.ID,
			"url", state.URL,
			"event", "validators_missing",
		)
	}

	return state, nil
}

func (e *Engine) Shutdown(ctx context.Context) error {
	e.mu.Lock()
	e.shuttingDown = true
	active := make([]*ActiveDownload, 0, len(e.active))
	for _, download := range e.active {
		active = append(active, download)
	}
	e.mu.Unlock()

	for _, download := range active {
		download.Cancel()
	}

	waitDone := make(chan struct{})
	go func() {
		for _, download := range active {
			<-download.Done
		}
		close(waitDone)
	}()

	select {
	case <-waitDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (e *Engine) assignDownloadTargetAndSave(state *DownloadState, requestedName string) error {
	e.targetMu.Lock()
	defer e.targetMu.Unlock()

	filename, outputPath, err := e.resolveDownloadTarget(state.URL, requestedName, state.ID)
	if err != nil {
		return err
	}

	state.Filename = filename
	state.OutputPath = outputPath
	return e.storage.SaveDownload(state)
}

func (e *Engine) Start(id string) error {
	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	e.mu.Lock()
	if e.shuttingDown {
		e.mu.Unlock()
		return fmt.Errorf("engine shutting down")
	}
	if _, ok := e.active[id]; ok {
		e.mu.Unlock()
		return fmt.Errorf("already active")
	}
	e.mu.Unlock()

	state.Status = "queued"
	clearDownloadFailureState(state)
	setDownloadSpeed(state, 0)
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
	restartAfterRemoteChange := false
	defer func() {
		closeActiveDownloadHTTPClient(a)
		if a.File != nil {
			_ = a.File.Close()
			a.File = nil
		}
		e.persistActiveState(a)
		close(a.Done)
		if restartAfterRemoteChange {
			if err := e.Start(a.State.ID); err != nil {
				restartErr := withErrorCode("remote_changed", fmt.Errorf("restart after remote change failed: %w", err))
				state, stateErr := e.storage.GetDownload(a.State.ID)
				if stateErr != nil {
					slog.Error("remote change recovery restart failed",
						"download_id", a.State.ID,
						"error", restartErr,
					)
					return
				}
				setDownloadFailureState(state, restartErr)
				e.persistSnapshot(cloneDownloadState(state))
			}
		}
	}()

	file, err := openDownloadOutputFile(a.State)
	if err != nil {
		e.failDownload(a, err)
		return
	}
	a.File = file

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
					setDownloadSpeed(a.State, diff*2)
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

	var expiredErr *urlExpiredError
	if errors.As(lastError, &expiredErr) {
		e.releaseActiveSlot(a.State.ID)

		a.mu.Lock()
		setDownloadAwaitingURLRefresh(a.State, "Link expired. Refresh URL to keep your progress.")
		snapshot := cloneDownloadState(a.State)
		a.mu.Unlock()

		slog.Warn("download awaiting refreshed url",
			"download_id", snapshot.ID,
			"url", snapshot.URL,
			"segment_index", expiredErr.SegmentIndex,
			"status_code", expiredErr.StatusCode,
			"event", "url_expired",
		)
		e.persistSnapshot(snapshot)
		return
	}

	var remoteRecoveryErr *remoteChangeRecoveryError
	if errors.As(lastError, &remoteRecoveryErr) {
		e.releaseActiveSlot(a.State.ID)
		if a.File != nil {
			_ = a.File.Close()
			a.File = nil
		}
		if err := e.invalidateAllProgressOnRemoteChange(a); err != nil {
			a.mu.Lock()
			setDownloadFailureState(a.State, err)
			snapshot := cloneDownloadState(a.State)
			a.mu.Unlock()

			slog.Error("download remote change recovery failed",
				"download_id", snapshot.ID,
				"url", snapshot.URL,
				"error", err,
				"error_code", snapshot.ErrorCode,
			)
			e.persistSnapshot(snapshot)
			return
		}
		restartAfterRemoteChange = true
		return
	}

	e.releaseActiveSlot(a.State.ID)

	a.mu.Lock()
	allDone := allSegmentsCompleted(a.State)
	if lastError != nil {
		setDownloadFailureState(a.State, lastError)
	} else if allDone {
		if a.State.TotalSize <= 0 {
			a.State.TotalSize = downloadedBytes(a.State)
		}
		if err := verifyDownloadIntegrity(a.State, e.hostSettingsSnapshot().VerifyIntegrityEnabled()); err != nil {
			err = withErrorCode("integrity_failed", err)
			var mismatchErr *integrityMismatchError
			if errors.As(err, &mismatchErr) {
				if renameErr := renameCorruptDownloadFile(a.State); renameErr != nil {
					slog.Error("download corrupt rename failed",
						"download_id", a.State.ID,
						"url", a.State.URL,
						"output_path", downloadPath(a.State),
						"error", renameErr,
					)
				}
				slog.Error("download integrity check failed",
					"download_id", a.State.ID,
					"url", a.State.URL,
					"output_path", downloadPath(a.State),
					"algorithm", mismatchErr.Algorithm,
					"expected", mismatchErr.Expected,
					"actual", mismatchErr.Actual,
					"error", err,
				)
			} else {
				slog.Error("download integrity check failed",
					"download_id", a.State.ID,
					"url", a.State.URL,
					"output_path", downloadPath(a.State),
					"error", err,
				)
			}
			setDownloadFailureState(a.State, err)
		} else {
			a.State.Status = "finished"
			a.State.Progress = 100
			setDownloadSpeed(a.State, 0)
			clearDownloadFailureState(a.State)
		}
	} else {
		a.State.Status = "paused"
		setDownloadSpeed(a.State, 0)
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
	for {
		completed := false
		for attempt := 0; attempt < maxSegmentRetries; attempt++ {
			err := e.downloadSegmentAttempt(a, idx, attempt)
			if err == nil {
				completed = true
				break
			}

			var resetErr *rangeResumeResetError
			if errors.As(err, &resetErr) {
				continue
			}

			if delay, ok := retryDelayForSegmentError(err, attempt); ok {
				a.mu.Lock()
				downloadID := a.State.ID
				requestURL := a.State.URL
				a.mu.Unlock()
				e.recordSegmentRetryAttempt(a, idx, requestURL, attempt+1, err, delay)
				if attempt == maxSegmentRetries-1 {
					finalErr := withErrorCode(downloadErrorCode(err), fmt.Errorf("segment %d exhausted retries: %w", idx, err))
					slog.Error("segment exhausted retries", segmentRetryLogAttrs(DownloadState{ID: downloadID}, idx, requestURL, attempt+1, err, delay)...)
					return finalErr
				}
				if waitErr := waitForRetry(a.Ctx, delay); waitErr != nil {
					return waitErr
				}
				continue
			}

			return err
		}

		if !completed {
			return withErrorCode("download_failed", fmt.Errorf("segment %d exhausted retries", idx))
		}

		stolen, ok := e.stealWorkFor(a, idx)
		if !ok {
			return nil
		}
		idx = stolen.Index
	}
}

func logForwardedCookieContext(requestURL string, headers map[string]string, cookies []RequestCookie) {
	if len(cookies) != 0 {
		return
	}

	slog.Info("0 cookies forwarded",
		"url", requestURL,
		"forwarded_header_count", len(headers),
	)
}

func (e *Engine) downloadSegmentAttempt(a *ActiveDownload, idx int, attempt int) error {
	stallTimeout := time.Duration(e.hostSettingsSnapshot().SegmentStallTimeoutSec) * time.Second
	a.mu.Lock()
	seg := a.State.Segments[idx]
	downloadID := a.State.ID
	stateURL := a.State.URL
	filename := a.State.Filename
	totalSize := a.State.TotalSize
	headers := cloneStringMap(a.State.Headers)
	segmentCount := len(a.State.Segments)
	ifRangeValue := preferredResumeValidator(a.State)
	a.mu.Unlock()

	startOffset := seg.Start + seg.Current
	if seg.End >= 0 && startOffset > seg.End {
		return e.completeSegment(a, idx)
	}

	a.mu.Lock()
	client := a.HTTPClient
	a.mu.Unlock()
	if client == nil {
		return fmt.Errorf("download client unavailable")
	}

	reqCtx, cancel := context.WithCancelCause(a.Ctx)
	defer cancel(nil)
	reqCtx, transportState := instrumentTransportAcquisition(reqCtx, a)

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, stateURL, nil)
	if err != nil {
		return err
	}
	applyClientManagedRequestHeaders(req, headers)

	rangeRequested := false
	ifRangeRequested := false
	switch {
	case seg.End >= 0 && (segmentCount > 1 || seg.Current > 0):
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", startOffset, seg.End))
		rangeRequested = true
	case seg.End < 0 && seg.Current > 0:
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", startOffset))
		rangeRequested = true
	}
	if rangeRequested && seg.Current > 0 && ifRangeValue != "" {
		req.Header.Set("If-Range", ifRangeValue)
		ifRangeRequested = true
	}

	resp, err := client.Do(req)
	if err != nil {
		return resolveRequestContextError(reqCtx, err)
	}
	defer resp.Body.Close()
	logTransportReuse(downloadID, stateURL, idx, attempt, transportState)
	stallReader := newStallWatchReader(reqCtx, resp.Body, cancel, stallTimeout)
	defer stallReader.Stop()
	reader := newThrottledReader(reqCtx, stallReader, &a.PerDownloadLimiter, e.globalLimiterSnapshot())

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusGone {
		reason := fmt.Sprintf("segment request returned status %d", resp.StatusCode)
		slog.Warn("segment detected expired url",
			"download_id", downloadID,
			"url", stateURL,
			"filename", filename,
			"segment_index", idx,
			"status_code", resp.StatusCode,
			"event", "url_expired",
		)
		return &urlExpiredError{SegmentIndex: idx, StatusCode: resp.StatusCode, Reason: reason}
	}
	if isHTMLAssetResponse(stateURL, resp, rangeRequested) {
		slog.Warn("segment detected html login or error page",
			"download_id", downloadID,
			"url", stateURL,
			"filename", filename,
			"segment_index", idx,
			"status_code", resp.StatusCode,
			"content_type", resp.Header.Get("Content-Type"),
			"event", "url_expired",
		)
		return &urlExpiredError{SegmentIndex: idx, StatusCode: resp.StatusCode, Reason: "segment request returned html login or error page"}
	}

	switch {
	case rangeRequested && resp.StatusCode == http.StatusRequestedRangeNotSatisfiable:
		if seg.Current > 0 {
			a.mu.Lock()
			a.State.Segments[idx].Current = 0
			a.State.Segments[idx].Completed = false
			a.mu.Unlock()

			slog.Warn("segment resume offset past eof; retrying from start",
				"download_id", downloadID,
				"url", stateURL,
				"segment_index", idx,
				"event", "segment_resume_reset",
			)
			return &rangeResumeResetError{SegmentIndex: idx}
		}

		err := withErrorCode("range_unsupported", &statusCodeError{StatusCode: resp.StatusCode, Message: "range not satisfiable"})
		slog.Error("segment range request not satisfiable",
			"download_id", downloadID,
			"url", stateURL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	case ifRangeRequested && resp.StatusCode == http.StatusOK:
		if totalSize > 0 && resp.ContentLength > 0 && resp.ContentLength != totalSize {
			err := withErrorCode("remote_changed", fmt.Errorf("remote file size changed during resume: expected %d, got %d", totalSize, resp.ContentLength))
			slog.Warn("segment resume detected remote size change",
				"download_id", downloadID,
				"url", stateURL,
				"segment_index", idx,
				"status_code", resp.StatusCode,
				"content_length", resp.ContentLength,
				"expected_total_size", totalSize,
				"event", "remote_changed_recovery",
			)
			return err
		}

		slog.Warn("segment resume detected remote change",
			"download_id", downloadID,
			"url", stateURL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
			"content_length", resp.ContentLength,
			"event", "remote_changed_recovery",
		)
		return &remoteChangeRecoveryError{SegmentIndex: idx, ContentLength: resp.ContentLength}
	case rangeRequested && resp.StatusCode != http.StatusPartialContent:
		err := classifySegmentHTTPError(resp.StatusCode, "range request returned status", resp.Header.Get("Retry-After"), attempt)
		var retryErr *retryableStatusError
		if errors.As(err, &retryErr) {
			return err
		}
		slog.Error("segment range request failed",
			"download_id", downloadID,
			"url", stateURL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	case !rangeRequested && resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent:
		err := classifySegmentHTTPError(resp.StatusCode, "unexpected status code", resp.Header.Get("Retry-After"), attempt)
		var retryErr *retryableStatusError
		if errors.As(err, &retryErr) {
			return err
		}
		slog.Error("segment request failed",
			"download_id", downloadID,
			"url", stateURL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	}

	if ifRangeRequested && resp.StatusCode == http.StatusPartialContent {
		slog.Info("segment resume validator matched",
			"download_id", downloadID,
			"url", stateURL,
			"segment_index", idx,
			"event", "segment_resume",
			"if_range_matched", true,
		)
	}

	buf := make([]byte, 32*1024)
	for {
		n, readErr := reader.Read(buf)
		if n > 0 {
			writeLen := n
			reachedSegmentEnd := false
			reservedOffset := int64(0)

			a.mu.Lock()
			segment := &a.State.Segments[idx]
			reservedOffset = segment.Start + segment.Current
			if totalLength := segmentTotalLength(*segment); totalLength > 0 {
				remaining := totalLength - segment.Current
				switch {
				case remaining <= 0:
					writeLen = 0
					reachedSegmentEnd = true
				case int64(writeLen) > remaining:
					writeLen = int(remaining)
					reachedSegmentEnd = true
				}
			}
			if writeLen > 0 {
				segment.Current += int64(writeLen)
				if totalLength := segmentTotalLength(*segment); totalLength > 0 && segment.Current >= totalLength {
					reachedSegmentEnd = true
				}
			}
			a.mu.Unlock()

			if writeLen == 0 {
				return e.completeSegment(a, idx)
			}

			written, writeErr := a.File.WriteAt(buf[:writeLen], reservedOffset)
			if writeErr != nil {
				a.mu.Lock()
				a.State.Segments[idx].Current -= int64(writeLen)
				a.mu.Unlock()
				return classifyDownloadIOError(writeErr)
			}
			if written != writeLen {
				a.mu.Lock()
				a.State.Segments[idx].Current -= int64(writeLen)
				a.mu.Unlock()
				return io.ErrShortWrite
			}

			if reachedSegmentEnd {
				return e.completeSegment(a, idx)
			}
		}

		if readErr != nil {
			if readErr == io.EOF {
				return e.completeSegment(a, idx)
			}
			return resolveRequestContextError(reqCtx, readErr)
		}
	}
}

func (e *Engine) invalidateAllProgressOnRemoteChange(a *ActiveDownload) error {
	a.Cancel()

	a.mu.Lock()
	downloadID := a.State.ID
	requestURL := a.State.URL
	requestHeaders := cloneStringMap(a.State.Headers)
	requestCookies := append([]RequestCookie(nil), a.State.Cookies...)
	requestedSegments := len(a.State.Segments)
	previousSize := a.State.TotalSize
	outputPath := downloadPath(a.State)
	resetSegmentsForRetry(a.State)
	a.State.Status = "queued"
	a.State.WasUserPaused = false
	clearDownloadFailureState(a.State)
	setDownloadSpeed(a.State, 0)
	a.mu.Unlock()

	slog.Warn("remote change recovery resetting progress",
		"download_id", downloadID,
		"url", requestURL,
		"event", "remote_changed_recovery",
		"action", "reset_segments",
	)

	if strings.TrimSpace(outputPath) != "" {
		if info, err := os.Stat(outputPath); err == nil && info.Size() > 0 {
			slog.Warn("remote change recovery removing output",
				"download_id", downloadID,
				"url", requestURL,
				"output_path", outputPath,
				"event", "remote_changed_recovery",
				"action", "remove_output",
			)
			if err := os.Remove(outputPath); err != nil && !os.IsNotExist(err) {
				return withErrorCode("remote_changed", err)
			}
		}
	}

	probeCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	meta, err := e.probeDownload(probeCtx, requestURL, requestHeaders, requestCookies)
	if err != nil {
		return withErrorCode("remote_changed", fmt.Errorf("re-probe after remote change failed: %w", err))
	}
	if previousSize > 0 && meta.TotalSize > 0 && meta.TotalSize != previousSize {
		return withErrorCode("remote_changed", fmt.Errorf("remote file size changed from %d to %d", previousSize, meta.TotalSize))
	}

	recoveredSize := previousSize
	if meta.TotalSize > 0 {
		recoveredSize = meta.TotalSize
	}
	requestedSegments = clampRequestedSegments(requestedSegments, e.hostSettingsSnapshot().MaxSegmentsPerDownload)

	a.mu.Lock()
	a.State.URL = meta.FinalURL
	a.State.TotalSize = recoveredSize
	a.State.ContentMD5 = meta.ContentMD5
	a.State.Digest = meta.Digest
	a.State.ETag = meta.ETag
	a.State.LastModified = meta.LastModified
	a.State.Segments = buildSegments(recoveredSize, requestedSegments, meta.AcceptRanges)
	a.State.Progress = 0
	a.State.Status = "queued"
	a.State.WasUserPaused = false
	clearDownloadFailureState(a.State)
	setDownloadSpeed(a.State, 0)
	a.mu.Unlock()

	slog.Warn("remote change recovery prepared restart",
		"download_id", downloadID,
		"url", meta.FinalURL,
		"total_size", recoveredSize,
		"accept_ranges", meta.AcceptRanges,
		"event", "remote_changed_recovery",
		"action", "restart",
	)

	return nil
}

func (e *Engine) completeSegment(a *ActiveDownload, idx int) error {
	a.mu.Lock()
	seg := &a.State.Segments[idx]
	if seg.End >= 0 {
		expected := seg.End - seg.Start + 1
		if seg.Current != expected {
			a.mu.Unlock()
			return withErrorCode("segment_size_mismatch", fmt.Errorf("segment %d size mismatch: expected %d, got %d", idx, expected, seg.Current))
		}
	} else if seg.Current <= 0 {
		a.mu.Unlock()
		return withErrorCode("segment_size_mismatch", fmt.Errorf("segment %d wrote no bytes before eof", idx))
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

func (e *Engine) Pause(ctx context.Context, id string) error {
	return e.pause(ctx, id, true)
}

func (e *Engine) pauseSystem(ctx context.Context, id string) error {
	return e.pause(ctx, id, false)
}

func (e *Engine) pause(ctx context.Context, id string, userInitiated bool) error {
	ctx = normalizedContext(ctx)
	if err := ctx.Err(); err != nil {
		return err
	}

	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	if state.Status == "finished" || state.Status == "error" {
		return nil
	}

	state.Status = "paused"
	setDownloadSpeed(state, 0)
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
		setDownloadSpeed(a.State, 0)
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

func (e *Engine) Resume(ctx context.Context, id string) error {
	ctx = normalizedContext(ctx)
	if err := ctx.Err(); err != nil {
		return err
	}

	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	if shouldResetSegmentsOnResume(state) {
		resetSegmentsForRetry(state)
	}
	state.WasUserPaused = false
	if err := e.storage.SaveDownload(state); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	return e.Start(id)
}

func (e *Engine) RefreshURL(ctx context.Context, id string, newURL string, force bool, restartFromScratch bool) (*DownloadState, error) {
	ctx = normalizedContext(ctx)
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	trimmedURL := strings.TrimSpace(newURL)
	if trimmedURL == "" {
		return nil, fmt.Errorf("url is required")
	}

	state, err := e.storage.GetDownload(id)
	if err != nil {
		return nil, err
	}
	if !statusAllowsURLRefresh(state) {
		return nil, fmt.Errorf("download must be awaiting url refresh, paused, or expired")
	}

	probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	meta, err := e.probeDownload(probeCtx, trimmedURL, cloneStringMap(state.Headers), append([]RequestCookie(nil), state.Cookies...))
	if err != nil {
		return nil, err
	}

	expectedSize := refreshURLExpectedSize(state)
	if !restartFromScratch && expectedSize > 0 && meta.TotalSize > 0 && meta.TotalSize != expectedSize {
		return nil, withErrorPayload("size_mismatch", map[string]interface{}{
			"expectedTotalSize": expectedSize,
			"actualTotalSize":   meta.TotalSize,
		}, fmt.Errorf("refreshed url points to different size: expected %d, got %d", expectedSize, meta.TotalSize))
	}
	if !restartFromScratch && !meta.AcceptRanges {
		return nil, withErrorPayload("accept_ranges_required", map[string]interface{}{
			"acceptRanges": false,
		}, fmt.Errorf("refreshed url does not support ranged resume"))
	}

	if state.ETag != "" {
		switch {
		case meta.ETag != "" && meta.ETag != state.ETag && !force:
			return nil, withErrorPayload("etag_mismatch", map[string]interface{}{
				"oldETag": state.ETag,
				"newETag": meta.ETag,
			}, fmt.Errorf("refreshed url points to a different etag"))
		case meta.ETag == "" && !force && !restartFromScratch:
			return nil, withErrorPayload("validators_missing", map[string]interface{}{
				"oldETag":         state.ETag,
				"newLastModified": meta.LastModified,
			}, fmt.Errorf("refreshed url no longer exposes validators"))
		}
	} else if state.LastModified != "" {
		switch {
		case meta.LastModified != "" && meta.LastModified != state.LastModified && !force:
			return nil, withErrorPayload("last_modified_mismatch", map[string]interface{}{
				"oldLastModified": state.LastModified,
				"newLastModified": meta.LastModified,
			}, fmt.Errorf("refreshed url points to a different last-modified value"))
		case meta.LastModified == "" && !force && !restartFromScratch:
			return nil, withErrorPayload("validators_missing", map[string]interface{}{
				"oldLastModified": state.LastModified,
				"newETag":         meta.ETag,
			}, fmt.Errorf("refreshed url no longer exposes validators"))
		}
	} else if !meta.hasValidators() && !force && !restartFromScratch {
		return nil, withErrorPayload("validators_missing", nil, fmt.Errorf("refreshed url is missing validators"))
	}

	if force || restartFromScratch {
		slog.Warn("download refresh forced",
			"download_id", state.ID,
			"url", meta.FinalURL,
			"event", "url_refresh_forced",
			"restart_from_scratch", restartFromScratch,
		)
	}

	if restartFromScratch {
		if err := removeDownloadOutputFile(state); err != nil {
			return nil, err
		}
		resetSegmentsForRetry(state)
		state.Progress = 0
		state.TotalSize = meta.TotalSize
		state.TotalSizeAtAdd = meta.TotalSize
		state.Segments = buildSegments(meta.TotalSize, clampRequestedSegments(requestedSegmentsForState(state), e.hostSettingsSnapshot().MaxSegmentsPerDownload), meta.AcceptRanges)
	}

	if !restartFromScratch {
		if expectedSize > 0 {
			state.TotalSize = expectedSize
		} else {
			state.TotalSize = meta.TotalSize
		}
		if state.TotalSizeAtAdd <= 0 {
			state.TotalSizeAtAdd = refreshURLExpectedSize(state)
		}
	}

	state.URL = meta.FinalURL
	state.ContentMD5 = meta.ContentMD5
	state.Digest = meta.Digest
	state.ETag = meta.ETag
	state.LastModified = meta.LastModified
	state.ProbedAt = time.Now().UTC()
	state.Status = "paused"
	state.Error = ""
	state.ErrorCode = ""
	state.LastAttemptAt = time.Time{}
	state.WasUserPaused = false
	setDownloadSpeed(state, 0)

	if err := e.storage.SaveDownload(state); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := e.Resume(ctx, state.ID); err != nil {
		return nil, err
	}

	updated, err := e.storage.GetDownload(state.ID)
	if err != nil {
		clone := cloneDownloadState(state)
		return &clone, nil
	}
	return updated, nil
}

func shouldResetSegmentsOnResume(state *DownloadState) bool {
	if state == nil || state.Status != "error" {
		return false
	}
	return strings.TrimSpace(state.ContentMD5) != "" || strings.TrimSpace(state.Digest) != ""
}

func resetSegmentsForRetry(state *DownloadState) {
	for index := range state.Segments {
		state.Segments[index].Current = 0
		state.Segments[index].Completed = false
	}
	state.Progress = 0
	setDownloadSpeed(state, 0)
}

func (e *Engine) Remove(ctx context.Context, id string, deleteFile bool) error {
	ctx = normalizedContext(ctx)
	if err := ctx.Err(); err != nil {
		return err
	}

	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	active := e.detachQueuedDownload(id)
	if active != nil {
		active.Cancel()
		select {
		case <-active.Done:
		case <-ctx.Done():
			return ctx.Err()
		}

		updatedState, updatedErr := e.storage.GetDownload(id)
		if updatedErr == nil {
			state = updatedState
		}
	}

	if deleteFile {
		if err := removeDownloadOutputFile(state); err != nil {
			return err
		}
	}
	if err := e.removeVideoArtifacts(state); err != nil {
		return err
	}
	if err := e.storage.DeleteDownload(id); err != nil {
		return err
	}

	slog.Info("download removed",
		"download_id", state.ID,
		"status", state.Status,
		"delete_file", deleteFile,
		"output_path", state.OutputPath,
	)
	return nil
}

func (e *Engine) detachQueuedDownload(id string) *ActiveDownload {
	e.mu.Lock()
	defer e.mu.Unlock()

	if _, ok := e.queuedSet[id]; ok {
		delete(e.queuedSet, id)
		for index, queuedID := range e.queued {
			if queuedID == id {
				e.queued = append(e.queued[:index], e.queued[index+1:]...)
				break
			}
		}
	}

	if active, ok := e.active[id]; ok {
		return active
	}
	return nil
}

func removeDownloadOutputFile(state *DownloadState) error {
	path := strings.TrimSpace(downloadPath(state))
	if path == "" {
		return nil
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (e *Engine) removeVideoArtifacts(state *DownloadState) error {
	if state.Type != "video" {
		return nil
	}
	segmentDir, err := e.videoSegmentDirPath(state)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(segmentDir); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (e *Engine) probeDownload(ctx context.Context, downloadURL string, headers map[string]string, cookies []RequestCookie) (downloadMetadata, error) {
	headResp, finalURL, err := doRequestWithRedirects(ctx, http.MethodHead, downloadURL, headers, cookies, nil)
	if err != nil {
		slog.Warn("download probe head request failed", "url", downloadURL, "error", err)
		return downloadMetadata{}, err
	}

	headMeta := metadataFromResponse(finalURL, headResp)
	headStatus := headResp.StatusCode
	_ = headResp.Body.Close()

	if headStatus == http.StatusOK && headMeta.TotalSize > 0 && headMeta.AcceptRanges && headMeta.hasValidators() {
		return headMeta, nil
	}

	plainGetStartURL := finalURL
	rangeStatus := 0
	rangeResp, rangeURL, rangeErr := doRequestWithRedirects(ctx, http.MethodGet, finalURL, headers, cookies, func(req *http.Request) {
		req.Header.Set("Range", "bytes=0-0")
	})
	if rangeURL != "" {
		plainGetStartURL = rangeURL
	}
	if rangeErr != nil {
		if headStatus == http.StatusOK && headMeta.TotalSize > 0 {
			return headMeta, nil
		}
		slog.Warn("download probe fallback request failed",
			"url", finalURL,
			"head_status_code", headStatus,
			"error", rangeErr,
		)
	} else {
		defer rangeResp.Body.Close()
		rangeStatus = rangeResp.StatusCode
		rangeMeta := mergeProbeMetadata(metadataFromResponse(rangeURL, rangeResp), headMeta)
		switch rangeResp.StatusCode {
		case http.StatusPartialContent, http.StatusOK:
			return rangeMeta, nil
		default:
			if headStatus == http.StatusOK && headMeta.TotalSize > 0 {
				return headMeta, nil
			}
			slog.Warn("download probe rejected",
				"url", rangeURL,
				"head_status_code", headStatus,
				"status_code", rangeResp.StatusCode,
			)
		}
	}

	plainResp, plainURL, plainErr := doRequestWithRedirects(ctx, http.MethodGet, plainGetStartURL, headers, cookies, nil)
	if plainErr != nil {
		return downloadMetadata{}, plainErr
	}
	defer plainResp.Body.Close()

	plainMeta := mergeProbeMetadata(metadataFromResponse(plainURL, plainResp), headMeta)
	switch plainResp.StatusCode {
	case http.StatusOK, http.StatusPartialContent:
		return plainMeta, nil
	default:
		err := &statusCodeError{StatusCode: plainResp.StatusCode, Message: "metadata probe returned status"}
		slog.Warn("download probe plain get rejected",
			"url", plainURL,
			"head_status_code", headStatus,
			"range_status_code", rangeStatus,
			"status_code", plainResp.StatusCode,
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

func downloadRequestURLs(state *DownloadState) []string {
	if state == nil {
		return nil
	}

	seen := make(map[string]struct{})
	urls := make([]string, 0, len(state.Segments)+1)
	appendURL := func(raw string) {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return
		}
		if _, ok := seen[trimmed]; ok {
			return
		}
		seen[trimmed] = struct{}{}
		urls = append(urls, trimmed)
	}

	appendURL(state.URL)
	for _, segment := range state.Segments {
		appendURL(segment.URL)
	}
	return urls
}

func seedCookieJar(jar http.CookieJar, rawURLs []string, cookies []RequestCookie) {
	if jar == nil || len(cookies) == 0 {
		return
	}

	jarCookies := make([]*http.Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		jarCookies = append(jarCookies, cookie.toHTTPCookie())
	}

	for _, rawURL := range rawURLs {
		parsedURL, err := url.Parse(rawURL)
		if err != nil {
			continue
		}
		jar.SetCookies(parsedURL, jarCookies)
	}
}

func newActiveDownloadHTTPClient(state *DownloadState) (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	seedCookieJar(jar, downloadRequestURLs(state), state.Cookies)

	baseTransport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return nil, fmt.Errorf("default transport unavailable")
	}
	transport := baseTransport.Clone()
	transport.Proxy = http.ProxyFromEnvironment
	transport.MaxIdleConns = 64
	transport.MaxIdleConnsPerHost = 32
	transport.MaxConnsPerHost = 32
	transport.IdleConnTimeout = 90 * time.Second
	transport.ForceAttemptHTTP2 = true
	transport.DisableCompression = true

	return &http.Client{
		Jar:       jar,
		Transport: transport,
	}, nil
}

func newHTTPClient(rawURL string, cookies []RequestCookie, followRedirects bool) (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}

	seedCookieJar(jar, []string{rawURL}, cookies)

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

func applyClientManagedRequestHeaders(req *http.Request, headers map[string]string) {
	applyRequestHeaders(req, headers, nil)
	req.Header.Del("Cookie")
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
		ETag:         resp.Header.Get("ETag"),
		LastModified: resp.Header.Get("Last-Modified"),
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

func clampRequestedSegments(requestedSegments int, maxSegments int) int {
	resolved := requestedSegments
	if resolved <= 0 {
		resolved = defaultSegments
	}
	if maxSegments > 0 && resolved > maxSegments {
		resolved = maxSegments
	}
	return resolved
}

func segmentTotalLength(seg Segment) int64 {
	if seg.End < seg.Start || seg.End < 0 {
		return 0
	}
	return seg.End - seg.Start + 1
}

func segmentRemainingBytes(seg Segment) int64 {
	if seg.Completed {
		return 0
	}
	totalLength := segmentTotalLength(seg)
	if totalLength <= 0 {
		return 0
	}
	remaining := totalLength - seg.Current
	if remaining < 0 {
		return 0
	}
	return remaining
}

func (e *Engine) stealWorkFor(a *ActiveDownload, idleIdx int) (*Segment, bool) {
	maxSegments := e.hostSettingsSnapshot().MaxSegmentsPerDownload

	a.mu.Lock()
	if maxSegments > 0 && len(a.State.Segments) >= maxSegments {
		a.mu.Unlock()
		return nil, false
	}

	victimIdx := -1
	victimRemaining := int64(0)
	for idx, seg := range a.State.Segments {
		if idx == idleIdx || seg.Completed {
			continue
		}
		remaining := segmentRemainingBytes(seg)
		if remaining > victimRemaining {
			victimIdx = idx
			victimRemaining = remaining
		}
	}
	if victimIdx < 0 || victimRemaining < segmentSplitThresholdBytes {
		a.mu.Unlock()
		return nil, false
	}

	victim := &a.State.Segments[victimIdx]
	remainingStart := victim.Start + victim.Current
	if remainingStart > victim.End {
		a.mu.Unlock()
		return nil, false
	}
	remaining := victim.End - remainingStart + 1
	if remaining < segmentSplitThresholdBytes {
		a.mu.Unlock()
		return nil, false
	}

	splitSize := remaining / 2
	if splitSize < 1 {
		a.mu.Unlock()
		return nil, false
	}
	splitPoint := remainingStart + splitSize - 1
	oldEnd := victim.End
	victim.End = splitPoint

	newSegment := Segment{
		Index:    len(a.State.Segments),
		Start:    splitPoint + 1,
		End:      oldEnd,
		Current:  0,
		URL:      victim.URL,
		Track:    victim.Track,
		Duration: victim.Duration,
	}
	a.State.Segments = append(a.State.Segments, newSegment)
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	newSize := segmentTotalLength(newSegment)
	slog.Info("segment split created",
		"download_id", snapshot.ID,
		"idle_index", idleIdx,
		"from_index", victimIdx,
		"from_remaining", victimRemaining,
		"new_index", newSegment.Index,
		"new_size", newSize,
		"event", "segment_split",
	)
	e.persistSnapshot(snapshot)

	stolen := newSegment
	return &stolen, true
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

func (e *Engine) resolveDownloadTarget(downloadURL string, requestedName string, downloadID string) (string, string, error) {
	downloadsDir, err := ResolveDownloadDir(e.HostSettings())
	if err != nil {
		return "", "", err
	}
	downloads, err := e.storage.ListDownloads()
	if err != nil {
		return "", "", err
	}
	return resolveDownloadTarget(downloadURL, requestedName, downloadsDir, downloads, downloadID)
}

func resolveDownloadTarget(downloadURL string, requestedName string, downloadsDir string, downloads []DownloadState, downloadID string) (string, string, error) {
	filename := strings.TrimSpace(filepath.Base(requestedName))
	if filename == "" || filename == "." || filename == string(filepath.Separator) {
		filename = filenameFromURL(downloadURL)
	}

	stem, ext := collisionNameParts(filename)
	for suffix := 1; ; suffix++ {
		candidate := collisionCandidateName(stem, ext, suffix)
		outputPath := filepath.Join(downloadsDir, candidate)
		if outputPathReserved(downloads, outputPath, downloadID) {
			continue
		}
		if _, err := os.Stat(outputPath); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return "", "", err
		}
		return candidate, outputPath, nil
	}
}

func collisionNameParts(filename string) (string, string) {
	ext := filepath.Ext(filename)
	stem := strings.TrimSuffix(filename, ext)
	if stem == "" {
		return filename, ""
	}
	return stem, ext
}

func collisionCandidateName(stem string, ext string, suffix int) string {
	if suffix <= 1 {
		return stem + ext
	}
	return fmt.Sprintf("%s (%d)%s", stem, suffix, ext)
}

func outputPathReserved(downloads []DownloadState, outputPath string, downloadID string) bool {
	candidate := filepath.Clean(outputPath)
	for _, download := range downloads {
		if download.ID == downloadID || strings.TrimSpace(download.OutputPath) == "" {
			continue
		}
		if filepath.Clean(download.OutputPath) == candidate {
			return true
		}
	}
	return false
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

func verifyDownloadIntegrity(state *DownloadState, verifyHash bool) error {
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

	if !verifyHash {
		slog.Info("download integrity skipped",
			"download_id", state.ID,
			"url", state.URL,
			"event", "integrity_skipped",
			"reason", "disabled",
		)
		return nil
	}
	if state.ContentMD5 == "" && state.Digest == "" {
		slog.Info("download integrity skipped",
			"download_id", state.ID,
			"url", state.URL,
			"event", "integrity_skipped",
			"reason", "no_hash_headers",
		)
		return nil
	}

	if state.ContentMD5 != "" {
		if err := verifyFileHash(downloadPath(state), "md5", md5.New(), state.ContentMD5); err != nil {
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

func verifyFileHash(path string, algorithm string, hasher hash.Hash, expectedBase64 string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	expectedBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(expectedBase64))
	if err != nil {
		return fmt.Errorf("invalid %s digest: %w", algorithm, err)
	}

	buffer := make([]byte, 4*1024*1024)
	if _, err := io.CopyBuffer(hasher, file, buffer); err != nil {
		return err
	}

	actualBytes := hasher.Sum(nil)
	actual := base64.StdEncoding.EncodeToString(actualBytes)
	if actual != strings.TrimSpace(expectedBase64) {
		return &integrityMismatchError{
			Algorithm: algorithm,
			Expected:  hex.EncodeToString(expectedBytes),
			Actual:    hex.EncodeToString(actualBytes),
		}
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
			if err := verifyFileHash(path, "md5", md5.New(), expected); err != nil {
				return err
			}
			verifiedAny = true
		case "sha-256":
			if err := verifyFileHash(path, "sha-256", sha256.New(), expected); err != nil {
				return err
			}
			verifiedAny = true
		case "sha-512":
			if err := verifyFileHash(path, "sha-512", sha512.New(), expected); err != nil {
				return err
			}
			verifiedAny = true
		}
	}

	if !verifiedAny {
		return nil
	}
	return nil
}

func renameCorruptDownloadFile(state *DownloadState) error {
	currentPath := strings.TrimSpace(downloadPath(state))
	if currentPath == "" {
		return nil
	}
	targetPath := corruptOutputPath(currentPath)
	if targetPath == currentPath {
		return nil
	}
	if err := os.Rename(currentPath, targetPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	state.OutputPath = targetPath
	state.Filename = filepath.Base(targetPath)
	return nil
}

func corruptOutputPath(currentPath string) string {
	baseTarget := currentPath + ".corrupt"
	if _, err := os.Stat(baseTarget); os.IsNotExist(err) {
		return baseTarget
	}
	for suffix := 2; ; suffix++ {
		candidate := fmt.Sprintf("%s.%d", baseTarget, suffix)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
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

func (e *Engine) persistActiveState(a *ActiveDownload) {
	a.mu.Lock()
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()
	e.persistSnapshot(snapshot)
}

func (e *Engine) failDownload(a *ActiveDownload, err error) {
	err = classifyDownloadIOError(err)
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

type transportAcquireState struct {
	reused    bool
	wasIdle   bool
	idleConns int64
}

func instrumentTransportAcquisition(ctx context.Context, a *ActiveDownload) (context.Context, *transportAcquireState) {
	state := &transportAcquireState{idleConns: a.IdleConnections.Load()}
	trace := &httptrace.ClientTrace{
		GotConn: func(info httptrace.GotConnInfo) {
			state.reused = info.Reused
			state.wasIdle = info.WasIdle
			if info.WasIdle {
				current := a.IdleConnections.Add(-1)
				if current < 0 {
					a.IdleConnections.Store(0)
					current = 0
				}
				state.idleConns = current
				return
			}
			state.idleConns = a.IdleConnections.Load()
		},
		PutIdleConn: func(err error) {
			if err == nil {
				a.IdleConnections.Add(1)
			}
		},
	}
	return httptrace.WithClientTrace(ctx, trace), state
}

func logTransportReuse(downloadID string, requestURL string, segmentIndex int, attempt int, state *transportAcquireState) {
	if state == nil {
		return
	}
	slog.Info("segment transport acquired",
		"download_id", downloadID,
		"url", requestURL,
		"segment_index", segmentIndex,
		"attempt", attempt+1,
		"event", "transport_reused",
		"reused", state.reused,
		"was_idle", state.wasIdle,
		"idle_conns", state.idleConns,
	)
}

func closeActiveDownloadHTTPClient(a *ActiveDownload) {
	if a == nil || a.HTTPClient == nil {
		return
	}
	a.HTTPClient.CloseIdleConnections()
}

func openDownloadOutputFile(state *DownloadState) (*os.File, error) {
	outputPath := downloadPath(state)
	if strings.TrimSpace(outputPath) == "" {
		return nil, fmt.Errorf("output path is required")
	}

	_, statErr := os.Stat(outputPath)
	hadExistingFile := statErr == nil
	file, err := os.OpenFile(outputPath, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, classifyDownloadIOError(err)
	}

	if state.TotalSize <= 0 {
		return file, nil
	}

	if err := preallocateFileSpace(file, state.TotalSize); err != nil {
		_ = file.Close()
		if !hadExistingFile {
			_ = os.Remove(outputPath)
		}
		return nil, classifyDownloadIOError(err)
	}

	return file, nil
}

func classifyDownloadIOError(err error) error {
	if err == nil {
		return nil
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "no space left on device") || strings.Contains(lower, "disk full") || strings.Contains(lower, "not enough space on the disk") {
		return withErrorCode("disk_full", err)
	}
	return err
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
		if e.shuttingDown {
			e.mu.Unlock()
			return
		}
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
	client, err := newActiveDownloadHTTPClient(state)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	settings := e.hostSettingsSnapshot()
	active := &ActiveDownload{
		State:      state,
		Ctx:        ctx,
		Cancel:     cancel,
		Done:       make(chan struct{}),
		HTTPClient: client,
	}
	active.PerDownloadLimiter.Store(newRateLimiter(settings.PerDownloadThrottleBytesPerSecond))

	e.mu.Lock()
	if e.shuttingDown {
		e.mu.Unlock()
		cancel()
		return fmt.Errorf("engine shutting down")
	}
	if _, ok := e.active[id]; ok {
		e.mu.Unlock()
		cancel()
		return fmt.Errorf("already active")
	}
	e.active[id] = active
	e.mu.Unlock()

	state.Status = "downloading"
	state.Error = ""
	setDownloadSpeed(state, 0)
	if err := e.storage.SaveDownload(state); err != nil {
		e.mu.Lock()
		delete(e.active, id)
		e.mu.Unlock()
		closeActiveDownloadHTTPClient(active)
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
	shouldDrain := !e.shuttingDown
	e.mu.Unlock()
	if shouldDrain {
		e.drainQueue()
	}
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
