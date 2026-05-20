package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestEngineAddFallsBackToRangeProbeAndResolvesRedirects(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte("hello redirected world")
	digest := md5.Sum(body)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, "/file.bin", http.StatusFound)
		case "/file.bin":
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			handleRangeResponse(w, r, body, digest)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{
		URL:      server.URL + "/redirect",
		Filename: "artifact.bin",
		Segments: 4,
	})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}

	if state.URL != server.URL+"/file.bin" {
		t.Fatalf("expected final URL %q, got %q", server.URL+"/file.bin", state.URL)
	}
	if state.TotalSize != int64(len(body)) {
		t.Fatalf("expected total size %d, got %d", len(body), state.TotalSize)
	}
	if len(state.Segments) != 4 {
		t.Fatalf("expected 4 segments, got %d", len(state.Segments))
	}
	settings, err := storage.GetHostSettings()
	if err != nil {
		t.Fatalf("GetHostSettings returned error: %v", err)
	}
	if got := filepath.Dir(state.OutputPath); got != settings.DownloadDir {
		t.Fatalf("expected output path in %q, got %q", settings.DownloadDir, state.OutputPath)
	}
}

func TestEngineAddFallsBackToPlainGetWhenHeadAndRangeAreRejected(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte("plain get probe")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			http.Error(w, "head forbidden", http.StatusForbidden)
			return
		}
		if r.Header.Get("Range") != "" {
			http.Error(w, "range forbidden", http.StatusForbidden)
			return
		}

		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{
		URL:      server.URL + "/plain.bin",
		Filename: "plain.bin",
		Segments: 4,
	})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}

	if state.URL != server.URL+"/plain.bin" {
		t.Fatalf("expected final URL %q, got %q", server.URL+"/plain.bin", state.URL)
	}
	if state.TotalSize != int64(len(body)) {
		t.Fatalf("expected total size %d, got %d", len(body), state.TotalSize)
	}
	if len(state.Segments) != 1 {
		t.Fatalf("expected single segment when range probe is rejected, got %d", len(state.Segments))
	}
}

func TestEngineAddUsesRangeProbeToCaptureValidatorsMissingFromHead(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte("validator probe body")
	digest := md5.Sum(body)
	etag := "W/\"validator-123\""
	lastModified := "Tue, 20 May 2026 12:34:56 GMT"
	var rangeProbeCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") == "bytes=0-0" {
			atomic.AddInt32(&rangeProbeCount, 1)
			w.Header().Set("ETag", etag)
			w.Header().Set("Last-Modified", lastModified)
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{
		URL:      server.URL + "/validators.bin",
		Filename: "validators.bin",
		Segments: 4,
	})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}

	if got := atomic.LoadInt32(&rangeProbeCount); got != 1 {
		t.Fatalf("expected exactly one range probe, got %d", got)
	}
	if state.ETag != etag {
		t.Fatalf("expected etag %q, got %q", etag, state.ETag)
	}
	if state.LastModified != lastModified {
		t.Fatalf("expected last-modified %q, got %q", lastModified, state.LastModified)
	}
	if state.TotalSizeAtAdd != int64(len(body)) {
		t.Fatalf("expected total size snapshot %d, got %d", len(body), state.TotalSizeAtAdd)
	}
	if state.ProbedAt.IsZero() {
		t.Fatal("expected probed timestamp to be set")
	}

	persisted, err := storage.GetDownload(state.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if persisted.ETag != etag {
		t.Fatalf("expected persisted etag %q, got %q", etag, persisted.ETag)
	}
	if persisted.LastModified != lastModified {
		t.Fatalf("expected persisted last-modified %q, got %q", lastModified, persisted.LastModified)
	}
}

func TestEngineAddWarnsWhenValidatorsAreUnavailable(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte("no validators")
	digest := md5.Sum(body)
	var logBuffer bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{
		URL:      server.URL + "/missing.bin",
		Filename: "missing.bin",
		Segments: 4,
	})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}

	if state.ETag != "" {
		t.Fatalf("expected empty etag, got %q", state.ETag)
	}
	if state.LastModified != "" {
		t.Fatalf("expected empty last-modified, got %q", state.LastModified)
	}
	if count := strings.Count(logBuffer.String(), "validators_missing"); count != 1 {
		t.Fatalf("expected one validators_missing warning, got %d logs: %s", count, logBuffer.String())
	}

	persisted, err := storage.GetDownload(state.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if persisted.ETag != "" || persisted.LastModified != "" {
		t.Fatalf("expected persisted validators empty, got etag=%q lastModified=%q", persisted.ETag, persisted.LastModified)
	}
}

func TestEngineDownloadUsesForwardedHeadersAndCookies(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("authenticated-download-", 256))
	digest := md5.Sum(body)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Referer") != "https://app.example.test/downloads" {
			http.Error(w, "missing referer", http.StatusForbidden)
			return
		}
		if !strings.Contains(r.Header.Get("User-Agent"), "TuyulDM-Test") {
			http.Error(w, "missing user-agent", http.StatusForbidden)
			return
		}
		cookie, err := r.Cookie("session")
		if err != nil || cookie.Value != "ok" {
			http.Error(w, "missing cookie", http.StatusForbidden)
			return
		}

		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{
		URL:      server.URL + "/secure.bin",
		Filename: "secure.bin",
		Segments: 4,
		Headers: map[string]string{
			"Authorization": "Bearer secret",
			"Referer":       "https://app.example.test/downloads",
			"User-Agent":    "TuyulDM-Test/1.0",
		},
		Cookies: []RequestCookie{{Name: "session", Value: "ok", Path: "/"}},
	})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}

	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "finished" {
		t.Fatalf("expected finished download, got %q (%s)", final.Status, final.Error)
	}

	downloaded, err := os.ReadFile(final.OutputPath)
	if err != nil {
		t.Fatalf("failed reading downloaded file: %v", err)
	}
	if string(downloaded) != string(body) {
		t.Fatalf("downloaded content mismatch")
	}
}

func TestEngineDownloadRetriesRetryAfter(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("retry-after-", 128))
	digest := md5.Sum(body)
	var attempts int32
	logBuffer := setTestLogger(t, slog.LevelWarn)
	startedAt := time.Now()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(digest[:]))
			w.Header().Set("ETag", `"retry-after"`)
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Method == http.MethodGet && r.Header.Get("Range") != "" {
			if atomic.AddInt32(&attempts, 1) == 1 {
				w.Header().Set("Retry-After", "5")
				w.WriteHeader(http.StatusTooManyRequests)
				return
			}
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/retry.bin", Filename: "retry.bin", Segments: 2})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 12*time.Second)
	if final.Status != "finished" {
		t.Fatalf("expected finished download, got %q (%s)", final.Status, final.Error)
	}
	if atomic.LoadInt32(&attempts) < 2 {
		t.Fatalf("expected at least 2 segment attempts, got %d", atomic.LoadInt32(&attempts))
	}
	if elapsed := time.Since(startedAt); elapsed < 5*time.Second {
		t.Fatalf("expected Retry-After delay of about 5s, got %s", elapsed)
	}
	if !strings.Contains(logBuffer.String(), "event=segment_retry") || !strings.Contains(logBuffer.String(), "retry_after_ms=5000") {
		t.Fatalf("expected segment_retry log with retry_after_ms=5000, got logs: %s", logBuffer.String())
	}
}

func TestEngineDownloadFatalHTTP404DoesNotRetry(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	var attempts int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", "128")
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("ETag", `"fatal-404"`)
			w.WriteHeader(http.StatusOK)
			return
		}
		atomic.AddInt32(&attempts, 1)
		http.Error(w, "missing", http.StatusNotFound)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/missing.bin", Filename: "missing.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "error" {
		t.Fatalf("expected error status, got %q", final.Status)
	}
	if final.ErrorCode != "fatal_http_404" {
		t.Fatalf("expected fatal_http_404 error code, got %q", final.ErrorCode)
	}
	if atomic.LoadInt32(&attempts) != 1 {
		t.Fatalf("expected no retries for 404, got %d attempts", atomic.LoadInt32(&attempts))
	}
}

func TestEngineDownloadRetriesAfterNetworkStall(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	if err := storage.SaveHostSettings(HostSettings{SegmentStallTimeoutSec: 5}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("stall-retry-", 256))
	digest := md5.Sum(body)
	var attempts int32
	logBuffer := setTestLogger(t, slog.LevelWarn)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"stall-etag"`)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(digest[:]))
			w.WriteHeader(http.StatusOK)
			return
		}

		if atomic.AddInt32(&attempts, 1) == 1 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body[:64])
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			<-r.Context().Done()
			return
		}

		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/stall.bin", Filename: "stall.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 15*time.Second)
	if final.Status != "finished" {
		t.Fatalf("expected finished download after stall retry, got %q (%s)", final.Status, final.Error)
	}
	if atomic.LoadInt32(&attempts) < 2 {
		t.Fatalf("expected stalled download to retry, got %d attempts", atomic.LoadInt32(&attempts))
	}
	if !strings.Contains(logBuffer.String(), `network_error="segment stalled"`) {
		t.Fatalf("expected network stall retry log, got logs: %s", logBuffer.String())
	}

	downloaded, err := os.ReadFile(final.OutputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, body) {
		t.Fatal("expected stalled download to recover and match source body")
	}
}

func TestNewActiveDownloadHTTPClientSeedsSegmentURLCookiesAndTunesTransport(t *testing.T) {
	state := &DownloadState{
		URL: "https://example.test/file.bin",
		Cookies: []RequestCookie{{
			Name:  "session",
			Value: "ok",
			Path:  "/",
		}},
		Segments: []Segment{{
			Index: 0,
			URL:   "https://example.test/video/segment-1.m4s",
		}},
	}

	client, err := newActiveDownloadHTTPClient(state)
	if err != nil {
		t.Fatalf("newActiveDownloadHTTPClient returned error: %v", err)
	}
	t.Cleanup(client.CloseIdleConnections)

	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", client.Transport)
	}
	if transport.MaxIdleConns != 64 {
		t.Fatalf("expected MaxIdleConns=64, got %d", transport.MaxIdleConns)
	}
	if transport.MaxIdleConnsPerHost != 32 {
		t.Fatalf("expected MaxIdleConnsPerHost=32, got %d", transport.MaxIdleConnsPerHost)
	}
	if transport.MaxConnsPerHost != 32 {
		t.Fatalf("expected MaxConnsPerHost=32, got %d", transport.MaxConnsPerHost)
	}
	if !transport.ForceAttemptHTTP2 {
		t.Fatal("expected ForceAttemptHTTP2 to be enabled")
	}
	if !transport.DisableCompression {
		t.Fatal("expected DisableCompression to be enabled")
	}

	segmentURL, err := url.Parse(state.Segments[0].URL)
	if err != nil {
		t.Fatalf("url.Parse returned error: %v", err)
	}
	jarCookies := client.Jar.Cookies(segmentURL)
	if len(jarCookies) != 1 || jarCookies[0].Name != "session" || jarCookies[0].Value != "ok" {
		t.Fatalf("expected seeded session cookie for segment url, got %#v", jarCookies)
	}
}

func TestOpenDownloadOutputFilePreallocatesAndPreservesPartialData(t *testing.T) {
	outputPath := filepath.Join(t.TempDir(), "preallocated.bin")
	prefix := []byte("partial-progress")
	if err := os.WriteFile(outputPath, prefix, 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	state := &DownloadState{
		OutputPath: outputPath,
		TotalSize:  4096,
	}
	file, err := openDownloadOutputFile(state)
	if err != nil {
		t.Fatalf("openDownloadOutputFile returned error: %v", err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		t.Fatalf("Stat returned error: %v", err)
	}
	if info.Size() != state.TotalSize {
		t.Fatalf("expected preallocated size %d, got %d", state.TotalSize, info.Size())
	}

	readPrefix := make([]byte, len(prefix))
	if _, err := file.ReadAt(readPrefix, 0); err != nil {
		t.Fatalf("ReadAt returned error: %v", err)
	}
	if !bytes.Equal(readPrefix, prefix) {
		t.Fatalf("expected partial bytes preserved, got %q", string(readPrefix))
	}
}

func TestEngineDownloadLogsTransportReuseOnRetry(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("transport-reuse-", 64))
	digest := md5.Sum(body)
	logBuffer := setTestLogger(t, slog.LevelInfo)
	var attempts atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"transport-reuse"`)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if attempts.Add(1) == 1 {
			w.Header().Set("Content-Length", "0")
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/reuse.bin", Filename: "reuse.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 6*time.Second)
	if final.Status != "finished" {
		t.Fatalf("expected finished download, got %q (%s)", final.Status, final.Error)
	}

	logs := logBuffer.String()
	if !strings.Contains(logs, "event=transport_reused") {
		t.Fatalf("expected transport_reused log entry, got logs: %s", logs)
	}
	if !strings.Contains(logs, "reused=true") {
		t.Fatalf("expected reused=true in transport log, got logs: %s", logs)
	}
}

func TestEngineStealWorkForSplitsLargestRemainingSegment(t *testing.T) {
	storage := newTestStorage(t)
	if err := storage.SaveHostSettings(HostSettings{MaxSegmentsPerDownload: 3}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	engine := NewEngine(storage, nil)

	const (
		victimEnd     = int64(10*1024*1024 - 1)
		victimCurrent = int64(1 * 1024 * 1024)
	)
	state := &DownloadState{
		ID:        "steal-work-unit",
		URL:       "https://example.test/file.bin",
		Status:    "downloading",
		Type:      "file",
		CreatedAt: time.Now(),
		Segments: []Segment{
			{Index: 0, Start: 0, End: victimEnd, Current: victimCurrent},
			{Index: 1, Start: victimEnd + 1, End: victimEnd + 1024, Current: 1024, Completed: true},
		},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	active := &ActiveDownload{State: state}
	stolen, ok := engine.stealWorkFor(active, 1)
	if !ok {
		t.Fatal("expected stealWorkFor to split remaining work")
	}
	if stolen.Index != 2 {
		t.Fatalf("expected new segment index 2, got %d", stolen.Index)
	}

	remainingStart := victimCurrent
	remaining := victimEnd - remainingStart + 1
	expectedSplitPoint := remainingStart + (remaining / 2) - 1
	if state.Segments[0].End != expectedSplitPoint {
		t.Fatalf("expected victim end %d, got %d", expectedSplitPoint, state.Segments[0].End)
	}
	if stolen.Start != expectedSplitPoint+1 {
		t.Fatalf("expected stolen start %d, got %d", expectedSplitPoint+1, stolen.Start)
	}
	if stolen.End != victimEnd {
		t.Fatalf("expected stolen end %d, got %d", victimEnd, stolen.End)
	}
	if stolen.Current != 0 {
		t.Fatalf("expected stolen segment current 0, got %d", stolen.Current)
	}
	if len(state.Segments) != 3 {
		t.Fatalf("expected 3 segments after split, got %d", len(state.Segments))
	}
}

func TestEngineStealWorkForRespectsMaxSegmentsCap(t *testing.T) {
	storage := newTestStorage(t)
	if err := storage.SaveHostSettings(HostSettings{MaxSegmentsPerDownload: 2}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	state := &DownloadState{
		ID:        "steal-work-cap",
		URL:       "https://example.test/file.bin",
		Status:    "downloading",
		Type:      "file",
		CreatedAt: time.Now(),
		Segments: []Segment{
			{Index: 0, Start: 0, End: 8*1024*1024 - 1, Current: 0},
			{Index: 1, Start: 8 * 1024 * 1024, End: 9*1024*1024 - 1, Current: 9*1024*1024 - 8*1024*1024, Completed: true},
		},
	}

	active := &ActiveDownload{State: state}
	if stolen, ok := engine.stealWorkFor(active, 1); ok || stolen != nil {
		t.Fatal("expected max segment cap to prevent split")
	}
	if len(state.Segments) != 2 {
		t.Fatalf("expected segment count unchanged at 2, got %d", len(state.Segments))
	}
}

func TestEngineDownloadStealsWorkFromSlowSegment(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	if err := storage.SaveHostSettings(HostSettings{MaxSegmentsPerDownload: 3}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("dynamic-split-", 800000))
	digest := md5.Sum(body)
	logBuffer := setTestLogger(t, slog.LevelInfo)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"segment-split"`)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if strings.HasPrefix(r.Header.Get("Range"), "bytes=0-") {
			handleSlowRangeResponse(w, r, body, digest, 32*1024, 40*time.Millisecond)
			return
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/split.bin", Filename: "split.bin", Segments: 2})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 12*time.Second)
	if final.Status != "finished" {
		t.Fatalf("expected finished download, got %q (%s)", final.Status, final.Error)
	}
	if len(final.Segments) < 3 {
		t.Fatalf("expected dynamic split to add a segment, got %d segments", len(final.Segments))
	}
	if !strings.Contains(logBuffer.String(), "event=segment_split") {
		t.Fatalf("expected segment_split log entry, got logs: %s", logBuffer.String())
	}

	downloaded, err := os.ReadFile(final.OutputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, body) {
		t.Fatal("expected dynamically split download to match source body")
	}
}

func TestEngineAddUsesConfiguredDownloadDir(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	configuredDir := filepath.Join(t.TempDir(), "downloads")
	if err := storage.SaveHostSettings(HostSettings{DownloadDir: configuredDir}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	body := []byte("custom-dir")
	digest := md5.Sum(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/custom.bin", Filename: "custom.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if got := filepath.Dir(state.OutputPath); got != configuredDir {
		t.Fatalf("expected output path under %q, got %q", configuredDir, got)
	}
}

func TestEngineAddAvoidsFilenameCollisionWithExistingFile(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	configuredDir := filepath.Join(t.TempDir(), "downloads")
	if err := os.MkdirAll(configuredDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	if err := storage.SaveHostSettings(HostSettings{DownloadDir: configuredDir}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configuredDir, "setup.exe"), []byte("existing"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	body := []byte("collision")
	digest := md5.Sum(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/setup.exe", Filename: "setup.exe", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if state.Filename != "setup (2).exe" {
		t.Fatalf("expected deduped filename, got %q", state.Filename)
	}
	if state.OutputPath != filepath.Join(configuredDir, "setup (2).exe") {
		t.Fatalf("expected deduped output path, got %q", state.OutputPath)
	}
}

func TestEngineAddAvoidsFilenameCollisionWithPersistedDownload(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	configuredDir := filepath.Join(t.TempDir(), "downloads")
	if err := os.MkdirAll(configuredDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	if err := storage.SaveHostSettings(HostSettings{DownloadDir: configuredDir}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	if err := storage.SaveDownload(&DownloadState{
		ID:         "existing",
		Filename:   "setup.exe",
		OutputPath: filepath.Join(configuredDir, "setup.exe"),
		Status:     "queued",
		Type:       "file",
		CreatedAt:  time.Now(),
	}); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	body := []byte("persisted-collision")
	digest := md5.Sum(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/setup.exe", Filename: "setup.exe", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if state.Filename != "setup (2).exe" {
		t.Fatalf("expected deduped filename, got %q", state.Filename)
	}
}

func TestEngineUpdateHostSettingsRejectsDownloadDirInsideDataDir(t *testing.T) {
	xdgDataHome := t.TempDir()
	t.Setenv("XDG_DATA_HOME", xdgDataHome)
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	dataDir, err := DataDir()
	if err != nil {
		t.Fatalf("DataDir returned error: %v", err)
	}

	err = engine.UpdateHostSettings(HostSettings{DownloadDir: filepath.Join(dataDir, "nested")})
	if err == nil {
		t.Fatal("expected download dir validation error")
	}
}

func TestStoragePauseActiveDownloads(t *testing.T) {
	storage := newTestStorage(t)
	state := &DownloadState{ID: "active", Filename: "file.bin", Status: "downloading", Type: "file", CreatedAt: time.Now()}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := storage.PauseActiveDownloads(); err != nil {
		t.Fatalf("PauseActiveDownloads returned error: %v", err)
	}

	updated, err := storage.GetDownload("active")
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if updated.Status != "paused" {
		t.Fatalf("expected paused status, got %q", updated.Status)
	}
}

func TestEnginePauseMarksQueuedDownloadAsUserPaused(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	state := &DownloadState{
		ID:        "queued",
		Filename:  "queued.bin",
		Status:    "queued",
		Type:      "file",
		CreatedAt: time.Now(),
		Segments:  []Segment{{Index: 0, Start: 0, End: -1}},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	engine.mu.Lock()
	engine.queued = []string{state.ID}
	engine.queuedSet[state.ID] = struct{}{}
	engine.mu.Unlock()

	if err := engine.Pause(state.ID); err != nil {
		t.Fatalf("Pause returned error: %v", err)
	}

	updated, err := storage.GetDownload(state.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if updated.Status != "paused" {
		t.Fatalf("expected paused status, got %q", updated.Status)
	}
	if !updated.WasUserPaused {
		t.Fatal("expected WasUserPaused to be true after manual pause")
	}

	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.queued) != 0 {
		t.Fatalf("expected queued list to be empty, got %v", engine.queued)
	}
	if _, ok := engine.queuedSet[state.ID]; ok {
		t.Fatal("expected queuedSet entry to be removed")
	}
}

func TestEngineUpdateHostSettingsPersistsAndRebalancesSlots(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)

	settings := HostSettings{
		MaxConcurrentDownloads:            2,
		GlobalThrottleBytesPerSecond:      2048,
		PerDownloadThrottleBytesPerSecond: 1024,
	}
	expected, err := validateHostSettingsUpdate(settings)
	if err != nil {
		t.Fatalf("validateHostSettingsUpdate returned error: %v", err)
	}
	if err := engine.UpdateHostSettings(settings); err != nil {
		t.Fatalf("UpdateHostSettings returned error: %v", err)
	}

	persisted, err := storage.GetHostSettings()
	if err != nil {
		t.Fatalf("GetHostSettings returned error: %v", err)
	}
	if !reflect.DeepEqual(persisted, expected) {
		t.Fatalf("expected persisted settings %+v, got %+v", expected, persisted)
	}

	current := engine.HostSettings()
	if !reflect.DeepEqual(current, expected) {
		t.Fatalf("expected in-memory settings %+v, got %+v", expected, current)
	}

	if engine.globalLimiter == nil {
		t.Fatal("expected global limiter to be configured")
	}
	if len(engine.slotPool) != expected.MaxConcurrentDownloads {
		t.Fatalf("expected %d available slots, got %d", expected.MaxConcurrentDownloads, len(engine.slotPool))
	}
}

func TestEngineRemoveQueuedDownloadDeletesRecordAndQueueEntry(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	state := &DownloadState{
		ID:         "queued-remove",
		Filename:   "queued.bin",
		OutputPath: filepath.Join(t.TempDir(), "queued.bin"),
		Status:     "queued",
		Type:       "file",
		CreatedAt:  time.Now(),
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	engine.mu.Lock()
	engine.queued = append(engine.queued, state.ID)
	engine.queuedSet[state.ID] = struct{}{}
	engine.mu.Unlock()

	if err := engine.Remove(state.ID, false); err != nil {
		t.Fatalf("Remove returned error: %v", err)
	}
	if _, err := storage.GetDownload(state.ID); err == nil {
		t.Fatal("expected queued download to be removed from storage")
	}

	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.queued) != 0 {
		t.Fatalf("expected queued list to be empty, got %v", engine.queued)
	}
	if _, ok := engine.queuedSet[state.ID]; ok {
		t.Fatal("expected queuedSet entry to be removed")
	}
}

func TestEngineRemoveFinishedDownloadDeletesFile(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	outputPath := filepath.Join(t.TempDir(), "finished.bin")
	if err := os.WriteFile(outputPath, []byte("done"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	state := &DownloadState{
		ID:         "finished-remove",
		Filename:   filepath.Base(outputPath),
		OutputPath: outputPath,
		Status:     "finished",
		Type:       "file",
		CreatedAt:  time.Now(),
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Remove(state.ID, true); err != nil {
		t.Fatalf("Remove returned error: %v", err)
	}
	if _, err := os.Stat(outputPath); !os.IsNotExist(err) {
		t.Fatalf("expected output file to be deleted, got err=%v", err)
	}
	if _, err := storage.GetDownload(state.ID); err == nil {
		t.Fatal("expected finished download to be removed from storage")
	}
}

func TestEngineRemoveVideoDownloadCleansSegmentDir(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	outputPath := filepath.Join(t.TempDir(), "video.mp4")
	segmentDir := filepath.Join(filepath.Dir(outputPath), ".segments", "video-remove")
	if err := os.MkdirAll(segmentDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	partPath := filepath.Join(segmentDir, "0000.part")
	if err := os.WriteFile(partPath, []byte("partial"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	state := &DownloadState{
		ID:         "video-remove",
		Filename:   filepath.Base(outputPath),
		OutputPath: outputPath,
		Status:     "paused",
		Type:       "video",
		CreatedAt:  time.Now(),
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Remove(state.ID, false); err != nil {
		t.Fatalf("Remove returned error: %v", err)
	}
	if _, err := os.Stat(segmentDir); !os.IsNotExist(err) {
		t.Fatalf("expected segment dir to be deleted, got err=%v", err)
	}
}

func TestEngineRemoveActiveDownloadWaitsForCancellation(t *testing.T) {
	t.Setenv("XDG_DOWNLOAD_DIR", filepath.Join(t.TempDir(), "downloads"))
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	requestStarted := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", "1024")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") != "" {
			w.Header().Set("Content-Range", "bytes 0-0/1024")
			w.Header().Set("Content-Length", "1")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("x"))
			return
		}
		requestStarted <- struct{}{}
		w.Header().Set("Content-Length", "1024")
		w.WriteHeader(http.StatusOK)
		<-r.Context().Done()
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/active.bin", Filename: "active.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	select {
	case <-requestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for active request")
	}

	removeDone := make(chan error, 1)
	go func() {
		removeDone <- engine.Remove(state.ID, false)
	}()

	select {
	case err := <-removeDone:
		if err != nil {
			t.Fatalf("Remove returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for Remove to finish")
	}

	if _, err := storage.GetDownload(state.ID); err == nil {
		t.Fatal("expected active download to be removed from storage")
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if _, ok := engine.active[state.ID]; ok {
		t.Fatal("expected active download entry to be removed")
	}
}

func TestEngineAddPersistsSchedule(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte("scheduled-download")
	digest := md5.Sum(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	schedule := &DownloadSchedule{StartHour: 2, EndHour: 6, Days: []int{1, 2, 3}}
	state, err := engine.Add(context.Background(), DownloadRequest{
		URL:      server.URL + "/schedule.bin",
		Filename: "schedule.bin",
		Segments: 1,
		Schedule: schedule,
	})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}

	if state.Schedule == nil {
		t.Fatal("expected schedule to be stored on returned state")
	}
	if state.Schedule.StartHour != schedule.StartHour || state.Schedule.EndHour != schedule.EndHour {
		t.Fatalf("unexpected schedule hours: %+v", state.Schedule)
	}
	if len(state.Schedule.Days) != len(schedule.Days) {
		t.Fatalf("unexpected schedule days length: got %d want %d", len(state.Schedule.Days), len(schedule.Days))
	}

	persisted, err := storage.GetDownload(state.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if persisted.Schedule == nil {
		t.Fatal("expected schedule to be persisted")
	}
	if persisted.Schedule.StartHour != schedule.StartHour || persisted.Schedule.EndHour != schedule.EndHour {
		t.Fatalf("unexpected persisted schedule hours: %+v", persisted.Schedule)
	}
}

func TestEngineAddHonorsCanceledContext(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte("cancel-me")
	digest := md5.Sum(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := engine.Add(ctx, DownloadRequest{URL: server.URL + "/cancel.bin", Filename: "cancel.bin", Segments: 1}); err == nil {
		t.Fatal("expected canceled context error")
	}
}

func TestEngineShutdownCancelsActiveDownloads(t *testing.T) {
	t.Setenv("XDG_DOWNLOAD_DIR", filepath.Join(t.TempDir(), "downloads"))
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	requestStarted := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", "1024")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") != "" {
			w.Header().Set("Content-Range", "bytes 0-0/1024")
			w.Header().Set("Content-Length", "1")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("x"))
			return
		}
		requestStarted <- struct{}{}
		w.Header().Set("Content-Length", "1024")
		w.WriteHeader(http.StatusOK)
		<-r.Context().Done()
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/shutdown.bin", Filename: "shutdown.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	select {
	case <-requestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for active request")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := engine.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("Shutdown returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "paused" {
		t.Fatalf("expected paused download after shutdown, got %q", final.Status)
	}
}

func TestEngineResumeSendsIfRangeAndCompletesOnValidatorMatch(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("resume-match-", 128))
	digest := md5.Sum(body)
	etag := `"resume-match-v1"`
	partialBytes := int64(len(body) / 3)
	logBuffer := setTestLogger(t, slog.LevelInfo)
	var sawIfRange atomic.Bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", etag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
			ifRange := r.Header.Get("If-Range")
			if ifRange == "" {
				http.Error(w, "missing If-Range", http.StatusPreconditionFailed)
				return
			}
			if ifRange != etag {
				http.Error(w, "bad If-Range", http.StatusPreconditionFailed)
				return
			}
			sawIfRange.Store(true)
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "resume-match.bin")
	writePartialDownloadFile(t, outputPath, body[:partialBytes])
	state := &DownloadState{
		ID:             "resume-if-range-match",
		URL:            server.URL + "/file.bin",
		Filename:       filepath.Base(outputPath),
		OutputPath:     outputPath,
		TotalSize:      int64(len(body)),
		TotalSizeAtAdd: int64(len(body)),
		Status:         "paused",
		Type:           "file",
		CreatedAt:      time.Now(),
		ETag:           etag,
		Segments: []Segment{{
			Index:   0,
			Start:   0,
			End:     int64(len(body)) - 1,
			Current: partialBytes,
		}},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Resume(state.ID); err != nil {
		t.Fatalf("Resume returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "finished" {
		t.Fatalf("expected finished download, got %q (%s)", final.Status, final.Error)
	}
	if !sawIfRange.Load() {
		t.Fatal("expected resume request to include If-Range")
	}
	if !strings.Contains(logBuffer.String(), "if_range_matched=true") {
		t.Fatalf("expected if_range_matched log entry, got logs: %s", logBuffer.String())
	}

	downloaded, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, body) {
		t.Fatal("expected resumed file to match source body")
	}
}

func TestEngineResumeRemoteChangeRedownloadsFromScratch(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	oldBody := bytes.Repeat([]byte("A"), 8192)
	newBody := bytes.Repeat([]byte("B"), 8192)
	newDigest := md5.Sum(newBody)
	oldETag := `"remote-old"`
	newETag := `"remote-new"`
	partialBytes := int64(len(oldBody) / 2)
	logBuffer := setTestLogger(t, slog.LevelWarn)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", newETag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") != "" && r.Header.Get("If-Range") == oldETag {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(newBody)
			return
		}
		handleRangeResponse(w, r, newBody, newDigest)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "remote-change.bin")
	writePartialDownloadFile(t, outputPath, oldBody[:partialBytes])
	state := &DownloadState{
		ID:             "resume-remote-change",
		URL:            server.URL + "/file.bin",
		Filename:       filepath.Base(outputPath),
		OutputPath:     outputPath,
		TotalSize:      int64(len(oldBody)),
		TotalSizeAtAdd: int64(len(oldBody)),
		Status:         "paused",
		Type:           "file",
		CreatedAt:      time.Now(),
		ETag:           oldETag,
		Segments: []Segment{{
			Index:   0,
			Start:   0,
			End:     int64(len(oldBody)) - 1,
			Current: partialBytes,
		}},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Resume(state.ID); err != nil {
		t.Fatalf("Resume returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "finished" {
		t.Fatalf("expected finished download after remote-change recovery, got %q (%s)", final.Status, final.Error)
	}
	if final.ETag != newETag {
		t.Fatalf("expected ETag updated to %q, got %q", newETag, final.ETag)
	}
	if !strings.Contains(logBuffer.String(), "remote_changed_recovery") {
		t.Fatalf("expected remote_changed_recovery logs, got: %s", logBuffer.String())
	}

	downloaded, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, newBody) {
		t.Fatal("expected full file to be redownloaded after remote change")
	}
}

func TestEngineResumeRemoteChangeSizeMismatchFails(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	oldBody := bytes.Repeat([]byte("C"), 4096)
	newBody := bytes.Repeat([]byte("D"), 2048)
	oldETag := `"size-old"`
	newETag := `"size-new"`
	partialBytes := int64(len(oldBody) / 2)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", newETag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") != "" && r.Header.Get("If-Range") == oldETag {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(newBody)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(newBody)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "remote-size-mismatch.bin")
	writePartialDownloadFile(t, outputPath, oldBody[:partialBytes])
	state := &DownloadState{
		ID:             "resume-remote-size-mismatch",
		URL:            server.URL + "/file.bin",
		Filename:       filepath.Base(outputPath),
		OutputPath:     outputPath,
		TotalSize:      int64(len(oldBody)),
		TotalSizeAtAdd: int64(len(oldBody)),
		Status:         "paused",
		Type:           "file",
		CreatedAt:      time.Now(),
		ETag:           oldETag,
		Segments: []Segment{{
			Index:   0,
			Start:   0,
			End:     int64(len(oldBody)) - 1,
			Current: partialBytes,
		}},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Resume(state.ID); err != nil {
		t.Fatalf("Resume returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "error" {
		t.Fatalf("expected remote size mismatch to fail, got %q", final.Status)
	}
	if final.ErrorCode != "remote_changed" {
		t.Fatalf("expected remote_changed error code, got %q", final.ErrorCode)
	}
}

func TestEngineDownloadMarksAwaitingURLRefreshOnExpiredLink(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	var attempts atomic.Int32
	logBuffer := setTestLogger(t, slog.LevelWarn)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"expired-link"`)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", "4096")
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		attempts.Add(1)
		http.Error(w, "expired", http.StatusForbidden)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/expired.bin", Filename: "expired.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 5*time.Second)
	if final.Status != "awaiting_url_refresh" {
		t.Fatalf("expected awaiting_url_refresh status, got %q (%s)", final.Status, final.Error)
	}
	if final.ErrorCode != "url_expired" {
		t.Fatalf("expected url_expired error code, got %q", final.ErrorCode)
	}
	if attempts.Load() != 1 {
		t.Fatalf("expected expired link to stop after one attempt, got %d", attempts.Load())
	}
	if !strings.Contains(logBuffer.String(), "event=url_expired") {
		t.Fatalf("expected url_expired log entry, got logs: %s", logBuffer.String())
	}
}

func TestEngineRefreshURLResumesExpiredDownload(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("refresh-resume-", 128))
	digest := md5.Sum(body)
	etag := `"refresh-match"`
	partialBytes := int64(len(body) / 3)
	var sawIfRange atomic.Bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", etag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") != "" {
			if r.Header.Get("If-Range") != etag {
				http.Error(w, "missing If-Range", http.StatusPreconditionFailed)
				return
			}
			sawIfRange.Store(true)
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "refresh-resume.bin")
	writePartialDownloadFile(t, outputPath, body[:partialBytes])
	state := &DownloadState{
		ID:             "refresh-url-resume",
		URL:            "https://expired.example.test/file.bin",
		Filename:       filepath.Base(outputPath),
		OutputPath:     outputPath,
		TotalSize:      int64(len(body)),
		TotalSizeAtAdd: int64(len(body)),
		Status:         "awaiting_url_refresh",
		Type:           "file",
		CreatedAt:      time.Now(),
		Error:          "Link expired. Refresh URL to keep your progress.",
		ErrorCode:      "url_expired",
		ETag:           etag,
		Segments: []Segment{{
			Index:   0,
			Start:   0,
			End:     int64(len(body)) - 1,
			Current: partialBytes,
		}},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	updated, err := engine.RefreshURL(state.ID, server.URL+"/file.bin", false, false)
	if err != nil {
		t.Fatalf("RefreshURL returned error: %v", err)
	}
	if updated.URL != server.URL+"/file.bin" {
		t.Fatalf("expected refreshed URL %q, got %q", server.URL+"/file.bin", updated.URL)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 5*time.Second)
	if final.Status != "finished" {
		t.Fatalf("expected finished download after refresh, got %q (%s)", final.Status, final.Error)
	}
	if final.ErrorCode != "" || final.Error != "" {
		t.Fatalf("expected refresh to clear error state, got code=%q error=%q", final.ErrorCode, final.Error)
	}
	if !sawIfRange.Load() {
		t.Fatal("expected resumed refresh download to include If-Range")
	}

	downloaded, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, body) {
		t.Fatal("expected refreshed resume file to match source body")
	}
}

func TestEngineRefreshURLReturnsETagMismatchDetails(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("etag-mismatch-", 64))
	newETag := `"etag-new"`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", newETag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "unexpected body request", http.StatusInternalServerError)
	}))
	defer server.Close()

	state := &DownloadState{
		ID:             "refresh-url-etag-mismatch",
		URL:            "https://expired.example.test/file.bin",
		Filename:       "etag-mismatch.bin",
		OutputPath:     filepath.Join(t.TempDir(), "etag-mismatch.bin"),
		TotalSize:      int64(len(body)),
		TotalSizeAtAdd: int64(len(body)),
		Status:         "awaiting_url_refresh",
		Type:           "file",
		CreatedAt:      time.Now(),
		ErrorCode:      "url_expired",
		ETag:           `"etag-old"`,
		Segments: []Segment{{
			Index: 0,
			Start: 0,
			End:   int64(len(body)) - 1,
		}},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	_, err := engine.RefreshURL(state.ID, server.URL+"/file.bin", false, false)
	if err == nil {
		t.Fatal("expected RefreshURL to fail on etag mismatch")
	}
	var coded *codedError
	if !errors.As(err, &coded) {
		t.Fatalf("expected codedError, got %T", err)
	}
	if coded.Code != "etag_mismatch" {
		t.Fatalf("expected etag_mismatch code, got %q", coded.Code)
	}
	details, ok := coded.Payload.(map[string]interface{})
	if !ok {
		t.Fatalf("expected mismatch details payload, got %#v", coded.Payload)
	}
	if details["oldETag"] != `"etag-old"` || details["newETag"] != newETag {
		t.Fatalf("expected old/new etag details, got %#v", details)
	}

	persisted, err := storage.GetDownload(state.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if persisted.Status != "awaiting_url_refresh" {
		t.Fatalf("expected state to remain awaiting_url_refresh, got %q", persisted.Status)
	}
	if persisted.URL != state.URL {
		t.Fatalf("expected state URL to remain %q, got %q", state.URL, persisted.URL)
	}
}

func TestEngineRefreshURLRestartsFromScratchOnSizeMismatch(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	oldBody := []byte(strings.Repeat("old-size-", 96))
	newBody := []byte(strings.Repeat("new-size-", 144))
	newDigest := md5.Sum(newBody)
	partialBytes := int64(len(oldBody) / 2)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"refresh-size-new"`)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(newBody)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		handleRangeResponse(w, r, newBody, newDigest)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "refresh-restart.bin")
	writePartialDownloadFile(t, outputPath, oldBody[:partialBytes])
	state := &DownloadState{
		ID:             "refresh-url-restart",
		URL:            "https://expired.example.test/file.bin",
		Filename:       filepath.Base(outputPath),
		OutputPath:     outputPath,
		TotalSize:      int64(len(oldBody)),
		TotalSizeAtAdd: int64(len(oldBody)),
		Status:         "awaiting_url_refresh",
		Type:           "file",
		CreatedAt:      time.Now(),
		ErrorCode:      "url_expired",
		ETag:           `"refresh-size-old"`,
		Segments: []Segment{{
			Index:   0,
			Start:   0,
			End:     int64(len(oldBody)) - 1,
			Current: partialBytes,
		}},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	updated, err := engine.RefreshURL(state.ID, server.URL+"/file.bin", true, true)
	if err != nil {
		t.Fatalf("RefreshURL returned error: %v", err)
	}
	if updated.TotalSizeAtAdd != int64(len(newBody)) {
		t.Fatalf("expected refreshed size snapshot %d, got %d", len(newBody), updated.TotalSizeAtAdd)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 5*time.Second)
	if final.Status != "finished" {
		t.Fatalf("expected forced refresh restart to finish, got %q (%s)", final.Status, final.Error)
	}
	if final.TotalSize != int64(len(newBody)) {
		t.Fatalf("expected total size updated to %d, got %d", len(newBody), final.TotalSize)
	}

	downloaded, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, newBody) {
		t.Fatal("expected forced refresh restart to redownload new body")
	}
}

func TestEngineResumeRangeNotSatisfiableRetriesFromSegmentStart(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("range-reset-", 64))
	digest := md5.Sum(body)
	etag := `"range-reset"`
	segments := buildSegments(int64(len(body)), 2, true)
	firstLength := segments[0].End - segments[0].Start + 1
	segments[0].Current = firstLength
	segments[0].Completed = true
	segments[1].Current = 5
	var rangeRequests atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", etag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") != "" {
			if rangeRequests.Add(1) == 1 {
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "range-reset.bin")
	writePartialDownloadFile(t, outputPath, body[:segments[1].Start+segments[1].Current])
	state := &DownloadState{
		ID:             "resume-range-reset",
		URL:            server.URL + "/file.bin",
		Filename:       filepath.Base(outputPath),
		OutputPath:     outputPath,
		TotalSize:      int64(len(body)),
		TotalSizeAtAdd: int64(len(body)),
		Status:         "paused",
		Type:           "file",
		CreatedAt:      time.Now(),
		ETag:           etag,
		Segments:       segments,
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Resume(state.ID); err != nil {
		t.Fatalf("Resume returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "finished" {
		t.Fatalf("expected download to finish after 416 retry, got %q (%s)", final.Status, final.Error)
	}
	if got := rangeRequests.Load(); got < 2 {
		t.Fatalf("expected resumed segment to retry after 416, got %d range requests", got)
	}

	downloaded, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, body) {
		t.Fatal("expected file to match source body after 416 retry")
	}
}

func TestEngineResumeRangeNotSatisfiableTwiceSurfacesRangeUnsupported(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("range-unsupported-", 32))
	etag := `"range-unsupported"`
	segments := buildSegments(int64(len(body)), 2, true)
	firstLength := segments[0].End - segments[0].Start + 1
	segments[0].Current = firstLength
	segments[0].Completed = true
	segments[1].Current = 5

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", etag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Range") != "" {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "range-unsupported.bin")
	writePartialDownloadFile(t, outputPath, body[:segments[1].Start+segments[1].Current])
	state := &DownloadState{
		ID:             "resume-range-unsupported",
		URL:            server.URL + "/file.bin",
		Filename:       filepath.Base(outputPath),
		OutputPath:     outputPath,
		TotalSize:      int64(len(body)),
		TotalSizeAtAdd: int64(len(body)),
		Status:         "paused",
		Type:           "file",
		CreatedAt:      time.Now(),
		ETag:           etag,
		Segments:       segments,
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Resume(state.ID); err != nil {
		t.Fatalf("Resume returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "error" {
		t.Fatalf("expected second 416 to fail, got %q", final.Status)
	}
	if final.ErrorCode != "range_unsupported" {
		t.Fatalf("expected range_unsupported error code, got %q", final.ErrorCode)
	}
}

func TestEngineResumeAfterIntegrityErrorResetsSegments(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	for len(engine.slotPool) > 0 {
		<-engine.slotPool
	}

	state := &DownloadState{
		ID:         "integrity-retry",
		URL:        "https://example.com/file.bin",
		Filename:   "file.bin",
		Status:     "error",
		Type:       "file",
		CreatedAt:  time.Now(),
		ContentMD5: "dGVzdA==",
		Segments: []Segment{
			{Index: 0, Start: 0, End: 9, Current: 10, Completed: true},
			{Index: 1, Start: 10, End: 19, Current: 5, Completed: false},
		},
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	if err := engine.Resume(state.ID); err != nil {
		t.Fatalf("Resume returned error: %v", err)
	}

	updated, err := storage.GetDownload(state.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if updated.Status != "queued" {
		t.Fatalf("expected queued status after resume, got %q", updated.Status)
	}
	for index, segment := range updated.Segments {
		if segment.Current != 0 {
			t.Fatalf("expected segment %d current reset, got %d", index, segment.Current)
		}
		if segment.Completed {
			t.Fatalf("expected segment %d completion reset", index)
		}
	}
}

func TestEngineDownloadLogsIntegritySkippedWithoutHashHeaders(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	settings := defaultHostSettings()
	settings.DownloadDir = t.TempDir()
	if err := engine.UpdateHostSettings(settings); err != nil {
		t.Fatalf("UpdateHostSettings returned error: %v", err)
	}
	body := []byte(strings.Repeat("integrity-skip-", 128))
	logBuffer := setTestLogger(t, slog.LevelInfo)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("ETag", `"integrity-skip"`)
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/skip.bin", Filename: "skip.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "finished" {
		t.Fatalf("expected finished download, got %q (%s)", final.Status, final.Error)
	}
	logs := logBuffer.String()
	if !strings.Contains(logs, "event=integrity_skipped") || !strings.Contains(logs, "reason=no_hash_headers") {
		t.Fatalf("expected integrity_skipped log with no_hash_headers reason, got logs: %s", logs)
	}
	if strings.Contains(final.OutputPath, ".corrupt") {
		t.Fatalf("did not expect corrupt rename for skipped integrity, got %q", final.OutputPath)
	}
}

func TestEngineDownloadSkipsIntegrityWhenDisabled(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	settings := defaultHostSettings()
	settings.DownloadDir = t.TempDir()
	settings.VerifyIntegrity = boolPtr(false)
	if err := engine.UpdateHostSettings(settings); err != nil {
		t.Fatalf("UpdateHostSettings returned error: %v", err)
	}
	logBuffer := setTestLogger(t, slog.LevelInfo)

	expectedBody := []byte(strings.Repeat("verify-off-", 128))
	corruptBody := append([]byte(nil), expectedBody...)
	corruptBody[len(corruptBody)/2] ^= 0xFF
	expectedDigest := md5.Sum(expectedBody)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(corruptBody)))
		w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(expectedDigest[:]))
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(corruptBody)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/disabled.bin", Filename: "disabled.bin", Segments: 1})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	originalPath := state.OutputPath
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "finished" {
		t.Fatalf("expected finished download with verify disabled, got %q (%s)", final.Status, final.Error)
	}
	if final.OutputPath != originalPath {
		t.Fatalf("expected output path to remain %q, got %q", originalPath, final.OutputPath)
	}
	downloaded, err := os.ReadFile(final.OutputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, corruptBody) {
		t.Fatal("expected downloaded file to match corrupt body when verification disabled")
	}
	logs := logBuffer.String()
	if !strings.Contains(logs, "event=integrity_skipped") || !strings.Contains(logs, "reason=disabled") {
		t.Fatalf("expected integrity_skipped log with disabled reason, got logs: %s", logs)
	}
}

func TestEngineDownloadIntegrityMismatchRenamesCorruptFile(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	settings := defaultHostSettings()
	settings.DownloadDir = t.TempDir()
	if err := engine.UpdateHostSettings(settings); err != nil {
		t.Fatalf("UpdateHostSettings returned error: %v", err)
	}
	logBuffer := setTestLogger(t, slog.LevelInfo)

	expectedBody := []byte(strings.Repeat("integrity-fail-", 128))
	corruptBody := append([]byte(nil), expectedBody...)
	corruptBody[len(corruptBody)/2] ^= 0xFF
	expectedDigest := md5.Sum(expectedBody)
	corruptDigest := md5.Sum(corruptBody)
	flipOffset := len(expectedBody) / 2

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(corruptBody)))
		w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(expectedDigest[:]))
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
			start := 0
			end := len(expectedBody) - 1
			if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err != nil {
				http.Error(w, "bad range", http.StatusRequestedRangeNotSatisfiable)
				return
			}
			chunk := append([]byte(nil), expectedBody[start:end+1]...)
			if flipOffset >= start && flipOffset <= end {
				chunk[flipOffset-start] ^= 0xFF
			}
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(expectedBody)))
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(chunk)))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(chunk)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(corruptBody)
	}))
	defer server.Close()

	state, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/corrupt.bin", Filename: "corrupt.bin", Segments: 2})
	if err != nil {
		t.Fatalf("Add returned error: %v", err)
	}
	originalPath := state.OutputPath
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "error" {
		t.Fatalf("expected integrity mismatch to fail, got %q", final.Status)
	}
	if final.ErrorCode != "integrity_failed" {
		t.Fatalf("expected integrity_failed error code, got %q", final.ErrorCode)
	}
	if final.OutputPath != originalPath+".corrupt" {
		t.Fatalf("expected corrupt rename to %q, got %q", originalPath+".corrupt", final.OutputPath)
	}
	if _, err := os.Stat(originalPath); !os.IsNotExist(err) {
		t.Fatalf("expected original path to be renamed away, stat error: %v", err)
	}
	downloaded, err := os.ReadFile(final.OutputPath)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if !bytes.Equal(downloaded, corruptBody) {
		t.Fatal("expected renamed corrupt file to preserve downloaded bytes")
	}
	logs := logBuffer.String()
	if !strings.Contains(logs, "expected="+hex.EncodeToString(expectedDigest[:])) || !strings.Contains(logs, "actual="+hex.EncodeToString(corruptDigest[:])) {
		t.Fatalf("expected integrity log to include expected and actual hex digests, got logs: %s", logs)
	}
}

func TestEngineCompleteSegmentRejectsSizeMismatch(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	state := &DownloadState{
		ID:        "segment-size-mismatch",
		URL:       "https://example.com/file.bin",
		Filename:  "file.bin",
		Status:    "downloading",
		Type:      "file",
		CreatedAt: time.Now(),
		Segments: []Segment{{
			Index:   0,
			Start:   0,
			End:     9,
			Current: 11,
		}},
	}

	err := engine.completeSegment(&ActiveDownload{State: state}, 0)
	if err == nil {
		t.Fatal("expected segment size mismatch error")
	}
	if code := downloadErrorCode(err); code != "segment_size_mismatch" {
		t.Fatalf("expected segment_size_mismatch error code, got %q", code)
	}
}

func newTestStorage(t *testing.T) *Storage {
	t.Helper()
	storage, err := NewStorage(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewStorage returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = storage.db.Close()
	})
	return storage
}

func writePartialDownloadFile(t *testing.T, outputPath string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	if err := os.WriteFile(outputPath, data, 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
}

func setTestLogger(t *testing.T, level slog.Level) *bytes.Buffer {
	t.Helper()
	var buffer bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buffer, &slog.HandlerOptions{Level: level})))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})
	return &buffer
}

func waitForTerminalState(t *testing.T, storage *Storage, id string) DownloadState {
	t.Helper()
	return waitForTerminalStateWithin(t, storage, id, 5*time.Second)
}

func waitForTerminalStateWithin(t *testing.T, storage *Storage, id string, timeout time.Duration) DownloadState {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		state, err := storage.GetDownload(id)
		if err == nil {
			switch state.Status {
			case "finished", "error", "paused", "awaiting_url_refresh":
				return *state
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for download %s", id)
	return DownloadState{}
}

func handleRangeResponse(w http.ResponseWriter, r *http.Request, body []byte, digest [16]byte) {
	w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(digest[:]))
	w.Header().Set("Accept-Ranges", "bytes")

	if r.Method == http.MethodHead {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
		w.WriteHeader(http.StatusOK)
		return
	}

	start := 0
	end := len(body) - 1
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err != nil {
			if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-", &start); err != nil {
				http.Error(w, "bad range", http.StatusRequestedRangeNotSatisfiable)
				return
			}
			end = len(body) - 1
		}

		if start < 0 || start >= len(body) || end < start {
			http.Error(w, "bad range", http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if end >= len(body) {
			end = len(body) - 1
		}

		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(body)))
		w.Header().Set("Content-Length", fmt.Sprintf("%d", end-start+1))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(body[start : end+1])
		return
	}

	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func handleSlowRangeResponse(w http.ResponseWriter, r *http.Request, body []byte, digest [16]byte, chunkSize int, chunkDelay time.Duration) {
	w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(digest[:]))
	w.Header().Set("Accept-Ranges", "bytes")

	start := 0
	end := len(body) - 1
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err != nil {
			if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-", &start); err != nil {
				http.Error(w, "bad range", http.StatusRequestedRangeNotSatisfiable)
				return
			}
			end = len(body) - 1
		}

		if start < 0 || start >= len(body) || end < start {
			http.Error(w, "bad range", http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if end >= len(body) {
			end = len(body) - 1
		}

		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(body)))
		w.Header().Set("Content-Length", fmt.Sprintf("%d", end-start+1))
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
		w.WriteHeader(http.StatusOK)
	}

	for offset := start; offset <= end; offset += chunkSize {
		select {
		case <-r.Context().Done():
			return
		default:
		}

		chunkEnd := offset + chunkSize
		if chunkEnd > end+1 {
			chunkEnd = end + 1
		}
		_, _ = w.Write(body[offset:chunkEnd])
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		if chunkEnd <= end {
			time.Sleep(chunkDelay)
		}
	}
}
