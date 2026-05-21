package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type VideoManifestPreview struct {
	ManifestType      string         `json:"manifestType"`
	SelectedVariantID string         `json:"selectedVariantId"`
	Variants          []VideoVariant `json:"variants"`
}

type videoTrackInput struct {
	Track string
	Path  string
}

func (e *Engine) AddVideo(ctx context.Context, req VideoDownloadRequest) (*DownloadState, error) {
	if strings.TrimSpace(req.URL) == "" {
		return nil, fmt.Errorf("url is required")
	}

	headers := sanitizeRequestHeaders(req.Headers)
	cookies := sanitizeRequestCookies(req.Cookies)
	logForwardedCookieContext(req.URL, headers, cookies)
	manifest, err := resolveVideoManifest(ctx, VideoDownloadRequest{
		URL:               req.URL,
		Filename:          req.Filename,
		ManifestType:      req.ManifestType,
		SelectedVariantID: req.SelectedVariantID,
		Segments:          req.Segments,
		Headers:           headers,
		Cookies:           cookies,
		Schedule:          req.Schedule,
	})
	if err != nil {
		return nil, err
	}

	parallelism := req.Segments
	if parallelism <= 0 {
		parallelism = defaultSegments
	}

	totalSize, knownSize := totalKnownSegmentBytes(manifest.Segments)
	if !knownSize {
		totalSize = 0
	}

	id := fmt.Sprintf("%d%d", os.Getpid(), time.Now().UnixNano())
	state := &DownloadState{
		ID:                 id,
		URL:                req.URL,
		TotalSize:          totalSize,
		Status:             "queued",
		Type:               "video",
		CreatedAt:          time.Now(),
		Headers:            headers,
		Cookies:            cookies,
		ManifestType:       manifest.ManifestType,
		SelectedVariantID:  manifest.SelectedVariantID,
		VideoContainer:     manifest.Container,
		Parallelism:        parallelism,
		Variants:           manifest.Variants,
		Segments:           manifest.Segments,
		Schedule:           cloneDownloadSchedule(req.Schedule),
		ExtractionStrategy: legacyStrategyFromManifest(manifest.ManifestType),
		SiteKey:            siteKeyFromURL(req.URL),
		TrackCount:         len(manifest.Variants),
	}

	if err := e.assignDownloadTargetAndSave(state, ensureVideoFilename(req.Filename)); err != nil {
		return nil, err
	}

	return state, nil
}

func legacyStrategyFromManifest(manifestType string) string {
	switch strings.ToUpper(strings.TrimSpace(manifestType)) {
	case manifestTypeHLS:
		return string(StrategyHLSManifest)
	case manifestTypeDASH:
		return string(StrategyDASHManifest)
	}
	return ""
}

// AddMediaOffer materializes a resolved MediaOffer into a DownloadState,
// dispatching to the file engine for direct/progressive offers and the video
// engine for manifest offers. Phase P compat path: delegates resolution work
// to existing engines, then stamps strategy metadata on the resulting state.
func (e *Engine) AddMediaOffer(ctx context.Context, offer *MediaOffer, req MediaDownloadRequest) (*DownloadState, error) {
	if offer == nil {
		return nil, fmt.Errorf("offer is required")
	}
	if offer.Protected || offer.Strategy == StrategyUnsupportedProtected {
		reason := strings.TrimSpace(offer.ProtectedReason)
		if reason == "" {
			reason = "drm_detected"
		}
		return nil, fmt.Errorf("offer refused: %s", reason)
	}

	switch offer.Strategy {
	case StrategyDirectFile, StrategyProgressiveStream:
		filename := pickFirstNonEmpty(req.Filename, offer.Title)
		state, err := e.Add(ctx, DownloadRequest{
			ID:       newDownloadStateID(),
			URL:      offer.SourceURL,
			Filename: filename,
			Headers:  offer.Headers,
			Cookies:  offer.Cookies,
			Schedule: cloneDownloadSchedule(req.Schedule),
		})
		if err != nil {
			return nil, err
		}
		return e.stampOfferMetadata(state, offer)
	case StrategyHLSManifest, StrategyDASHManifest, StrategyMSEObserved:
		videoReq := videoDownloadRequestFromOffer(offer, req.SelectedVariantID, pickFirstNonEmpty(req.Filename, offer.Title), req.Schedule)
		state, err := e.AddVideo(ctx, videoReq)
		if err != nil {
			return nil, err
		}
		return e.stampOfferMetadata(state, offer)
	default:
		return nil, fmt.Errorf("offer strategy %q not supported yet", offer.Strategy)
	}
}

func newDownloadStateID() string {
	return fmt.Sprintf("%d%d", os.Getpid(), time.Now().UnixNano())
}

func (e *Engine) stampOfferMetadata(state *DownloadState, offer *MediaOffer) (*DownloadState, error) {
	if state == nil || offer == nil {
		return state, nil
	}
	state.ExtractionStrategy = string(offer.Strategy)
	state.SiteKey = offer.SiteKey
	state.OfferTitle = offer.Title
	state.OfferDebug = compactOfferDebug(offer)
	state.TrackCount = offerTrackCount(offer)
	if plan, err := PlanFromOffer(offer); err == nil {
		state.Plan = plan
	}
	state.AssemblyStage = AssemblyStageFetching
	e.persistSnapshot(cloneDownloadState(state))
	return state, nil
}

func previewVideoManifest(ctx context.Context, req VideoDownloadRequest) (VideoManifestPreview, error) {
	manifest, err := resolveVideoManifest(ctx, req)
	if err != nil {
		return VideoManifestPreview{}, err
	}

	return VideoManifestPreview{
		ManifestType:      manifest.ManifestType,
		SelectedVariantID: manifest.SelectedVariantID,
		Variants:          manifest.Variants,
	}, nil
}

func ensureVideoFilename(requested string) string {
	trimmed := strings.TrimSpace(requested)
	if trimmed == "" {
		return fmt.Sprintf("Video_%d.mp4", time.Now().Unix())
	}
	if strings.EqualFold(filepath.Ext(trimmed), ".mp4") {
		return trimmed
	}
	return strings.TrimSuffix(trimmed, filepath.Ext(trimmed)) + ".mp4"
}

func totalKnownSegmentBytes(segments []Segment) (int64, bool) {
	var total int64
	for _, segment := range segments {
		if segment.End < segment.Start || segment.End < 0 {
			return 0, false
		}
		total += segment.End - segment.Start + 1
	}
	return total, len(segments) > 0
}

func (e *Engine) runVideoDownload(a *ActiveDownload) {
	defer closeActiveDownloadHTTPClient(a)
	defer close(a.Done)
	defer e.persistActiveState(a)

	segmentDir, err := e.videoSegmentDir(a.State)
	if err != nil {
		e.failDownload(a, err)
		return
	}

	done := make(chan struct{})
	go e.reportVideoProgress(a, done)

	var lastError error
	jobs := make(chan int)
	var workers sync.WaitGroup
	workerCount := resolvedVideoParallelism(a.State)
	if workerCount < 1 {
		workerCount = 1
	}

	for workerIndex := 0; workerIndex < workerCount; workerIndex++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for segmentIndex := range jobs {
				if err := e.downloadVideoSegment(a, segmentIndex, segmentDir); err != nil && !errors.Is(err, context.Canceled) {
					a.mu.Lock()
					if lastError == nil {
						lastError = err
						a.Cancel()
					}
					a.mu.Unlock()
				}
			}
		}()
	}

	for index := range a.State.Segments {
		if a.State.Segments[index].Completed {
			continue
		}
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	close(done)

	if lastError == nil && a.Ctx.Err() == nil {
		var inputs []videoTrackInput
		inputs, err = e.prepareVideoTrackInputs(a.State, segmentDir)
		if err == nil {
			err = e.muxVideoSegments(a, inputs, downloadPath(a.State))
		}
		if err == nil {
			_ = os.RemoveAll(segmentDir)
		}
	} else {
		err = lastError
	}

	e.releaseActiveSlot(a.State.ID)

	a.mu.Lock()
	if err != nil {
		if errors.Is(a.Ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) {
			a.State.Status = "paused"
		} else {
			setDownloadFailureState(a.State, err)
		}
		setDownloadSpeed(a.State, 0)
	} else {
		a.State.Status = "finished"
		a.State.AssemblyStage = AssemblyStageFinalizing
		a.State.Progress = 100
		setDownloadSpeed(a.State, 0)
		clearDownloadFailureState(a.State)
		if info, statErr := os.Stat(downloadPath(a.State)); statErr == nil {
			a.State.TotalSize = info.Size()
		}
	}
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	e.persistSnapshot(snapshot)
}

func (e *Engine) reportVideoProgress(a *ActiveDownload, done <-chan struct{}) {
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
					a.State.Progress = videoSegmentProgress(a.State)
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
}

func videoSegmentProgress(state *DownloadState) float64 {
	if len(state.Segments) == 0 {
		return 0
	}

	var completed float64
	for _, segment := range state.Segments {
		if segment.Completed {
			completed += 1
			continue
		}
		if segment.End >= segment.Start && segment.End >= 0 {
			length := float64(segment.End - segment.Start + 1)
			if length > 0 {
				completed += math.Min(1, float64(segment.Current)/length)
			}
		}
	}

	return completed / float64(len(state.Segments)) * 100
}

func resolvedVideoParallelism(state *DownloadState) int {
	if state.Parallelism > 0 {
		return state.Parallelism
	}
	return minInt(defaultSegments, len(state.Segments))
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func (e *Engine) downloadVideoSegment(a *ActiveDownload, idx int, segmentDir string) error {
	for attempt := 0; attempt < maxSegmentRetries; attempt++ {
		err := e.downloadVideoSegmentAttempt(a, idx, segmentDir, attempt)
		if err == nil {
			return nil
		}

		var retryErr *retryableStatusError
		if errors.As(err, &retryErr) {
			a.mu.Lock()
			downloadID := a.State.ID
			segmentURL := a.State.Segments[idx].URL
			a.mu.Unlock()
			e.recordRetryableAttempt(a, idx, segmentURL, attempt+1, retryErr, "video segment retry scheduled")
			if attempt == maxSegmentRetries-1 {
				finalErr := withErrorCode(downloadErrorCode(err), fmt.Errorf("video segment %d exhausted retries: %w", idx, err))
				slog.Error("video segment exhausted retries",
					"download_id", downloadID,
					"url", segmentURL,
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

	return withErrorCode("download_failed", fmt.Errorf("video segment %d exhausted retries", idx))
}

func (e *Engine) downloadVideoSegmentAttempt(a *ActiveDownload, idx int, segmentDir string, attempt int) error {
	a.mu.Lock()
	segment := a.State.Segments[idx]
	downloadID := a.State.ID
	headers := cloneStringMap(a.State.Headers)
	client := a.HTTPClient
	a.mu.Unlock()

	if segment.Completed {
		return nil
	}

	partPath := videoSegmentPartPath(segmentDir, segment.Index)
	file, resumeOffset, err := prepareVideoSegmentFile(a, idx, partPath)
	if err != nil {
		return err
	}
	defer file.Close()

	if segment.End >= segment.Start && segment.End >= 0 {
		expectedLength := segment.End - segment.Start + 1
		if resumeOffset >= expectedLength {
			return e.completeSegment(a, idx)
		}
	}

	if client == nil {
		return fmt.Errorf("download client unavailable")
	}

	reqCtx, transportState := instrumentTransportAcquisition(a.Ctx, a)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, segment.URL, nil)
	if err != nil {
		return err
	}
	applyClientManagedRequestHeaders(req, headers)

	rangeRequested := false
	writeOffset := resumeOffset
	switch {
	case segment.End >= segment.Start && segment.End >= 0:
		requestStart := segment.Start + resumeOffset
		if requestStart > segment.End {
			return e.completeSegment(a, idx)
		}
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", requestStart, segment.End))
		rangeRequested = true
	case resumeOffset > 0:
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", resumeOffset))
		rangeRequested = true
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	logTransportReuse(downloadID, segment.URL, idx, attempt, transportState)
	reader := newThrottledReader(a.Ctx, resp.Body, &a.PerDownloadLimiter, e.globalLimiterSnapshot())

	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
		return &retryableStatusError{StatusCode: resp.StatusCode, RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After"))}
	}

	switch {
	case rangeRequested && segment.End >= segment.Start && segment.End >= 0 && resp.StatusCode != http.StatusPartialContent:
		err := &statusCodeError{StatusCode: resp.StatusCode, Message: "video range request returned status"}
		slog.Error("video segment range request failed",
			"download_id", downloadID,
			"url", segment.URL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	case rangeRequested && segment.End < 0 && resumeOffset > 0 && resp.StatusCode == http.StatusOK:
		if err := file.Truncate(0); err != nil {
			return err
		}
		writeOffset = 0
		a.mu.Lock()
		a.State.Segments[idx].Current = 0
		a.mu.Unlock()
	case !rangeRequested && resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent:
		err := &statusCodeError{StatusCode: resp.StatusCode, Message: "unexpected video segment status"}
		slog.Error("video segment request failed",
			"download_id", downloadID,
			"url", segment.URL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	case rangeRequested && resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK:
		err := &statusCodeError{StatusCode: resp.StatusCode, Message: "unexpected video segment status"}
		slog.Error("video segment request failed",
			"download_id", downloadID,
			"url", segment.URL,
			"segment_index", idx,
			"status_code", resp.StatusCode,
		)
		return err
	}

	buf := make([]byte, 32*1024)
	for {
		n, readErr := reader.Read(buf)
		if n > 0 {
			written, writeErr := file.WriteAt(buf[:n], writeOffset)
			if writeErr != nil {
				return classifyDownloadIOError(writeErr)
			}
			if written != n {
				return io.ErrShortWrite
			}
			writeOffset += int64(n)

			a.mu.Lock()
			a.State.Segments[idx].Current = writeOffset
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

func prepareVideoSegmentFile(a *ActiveDownload, idx int, path string) (*os.File, int64, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, 0, err
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, 0, err
	}

	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, 0, err
	}

	resumeOffset := info.Size()
	a.mu.Lock()
	segment := a.State.Segments[idx]
	a.mu.Unlock()

	if segment.End >= segment.Start && segment.End >= 0 {
		expectedLength := segment.End - segment.Start + 1
		if resumeOffset > expectedLength {
			if err := file.Truncate(expectedLength); err != nil {
				_ = file.Close()
				return nil, 0, err
			}
			resumeOffset = expectedLength
		}
	}

	a.mu.Lock()
	a.State.Segments[idx].Current = resumeOffset
	a.mu.Unlock()

	return file, resumeOffset, nil
}

func (e *Engine) videoSegmentDir(state *DownloadState) (string, error) {
	path, err := e.videoSegmentDirPath(state)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return "", err
	}
	return path, nil
}

func (e *Engine) videoSegmentDirPath(state *DownloadState) (string, error) {
	baseDir := filepath.Dir(strings.TrimSpace(downloadPath(state)))
	if baseDir == "" || baseDir == "." {
		downloadsDir, err := ResolveDownloadDir(e.HostSettings())
		if err != nil {
			return "", err
		}
		baseDir = downloadsDir
	}
	return filepath.Join(baseDir, ".segments", state.ID), nil
}

func videoSegmentPartPath(segmentDir string, index int) string {
	return filepath.Join(segmentDir, fmt.Sprintf("%04d.part", index))
}

func (e *Engine) prepareVideoTrackInputs(state *DownloadState, segmentDir string) ([]videoTrackInput, error) {
	groups := make(map[string][]Segment)
	for _, segment := range state.Segments {
		track := segment.Track
		if track == "" {
			track = "muxed"
		}
		groups[track] = append(groups[track], segment)
	}

	inputs := make([]videoTrackInput, 0, len(groups))
	for _, track := range orderedTrackNames(groups) {
		outputPath := filepath.Join(segmentDir, track+trackContainerExt(state, track))
		outputFile, err := os.OpenFile(outputPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return nil, err
		}

		for _, segment := range groups[track] {
			partFile, err := os.Open(videoSegmentPartPath(segmentDir, segment.Index))
			if err != nil {
				_ = outputFile.Close()
				return nil, err
			}
			if _, err := io.Copy(outputFile, partFile); err != nil {
				_ = partFile.Close()
				_ = outputFile.Close()
				return nil, err
			}
			_ = partFile.Close()
		}

		if err := outputFile.Close(); err != nil {
			return nil, err
		}
		inputs = append(inputs, videoTrackInput{Track: track, Path: outputPath})
	}

	return inputs, nil
}

func orderedTrackNames(groups map[string][]Segment) []string {
	preferredOrder := []string{"video", "audio", "muxed"}
	ordered := make([]string, 0, len(groups))
	for _, track := range preferredOrder {
		if _, ok := groups[track]; ok {
			ordered = append(ordered, track)
		}
	}
	for track := range groups {
		if track == "video" || track == "audio" || track == "muxed" {
			continue
		}
		ordered = append(ordered, track)
	}
	return ordered
}

func trackContainerExt(state *DownloadState, track string) string {
	if state.ManifestType == manifestTypeHLS && state.VideoContainer == "ts" && track == "muxed" {
		return ".ts"
	}
	return ".mp4"
}

func (e *Engine) muxVideoSegments(a *ActiveDownload, inputs []videoTrackInput, output string) error {
	a.mu.Lock()
	a.State.Status = "muxing"
	if len(inputs) > 1 {
		a.State.AssemblyStage = AssemblyStageMuxing
	} else {
		a.State.AssemblyStage = AssemblyStageRemuxing
	}
	setDownloadSpeed(a.State, 0)
	a.State.Speed = "muxing"
	snapshot := cloneDownloadState(a.State)
	a.mu.Unlock()

	e.persistSnapshot(snapshot)

	ffmpegBinary, err := ResolveFFmpegBinary()
	if err != nil {
		return err
	}
	if err := os.RemoveAll(output); err != nil && !os.IsNotExist(err) {
		return err
	}

	args := []string{"-y"}
	for _, input := range inputs {
		args = append(args, "-i", input.Path)
	}
	args = append(args, "-c", "copy")
	if len(inputs) == 1 && strings.HasSuffix(strings.ToLower(inputs[0].Path), ".ts") {
		args = append(args, "-bsf:a", "aac_adtstoasc")
	}
	args = append(args, "-movflags", "+faststart", output)

	cmd := exec.CommandContext(a.Ctx, ffmpegBinary, args...)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		wrapped := withErrorCode("ffmpeg_mux_failed", fmt.Errorf("ffmpeg mux failed: %w", err))
		slog.Error("ffmpeg mux failed",
			"download_id", a.State.ID,
			"url", a.State.URL,
			"output_path", output,
			"error", wrapped,
			"ffmpeg_output_tail", trimLogTail(outputBytes, 4096),
		)
		return wrapped
	}
	return nil
}
