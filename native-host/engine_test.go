package main

import (
	"crypto/md5"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

	state, err := engine.Add(DownloadRequest{
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
	if !strings.HasSuffix(state.OutputPath, filepath.Join("downloads", "artifact.bin")) {
		t.Fatalf("expected output path in downloads dir, got %q", state.OutputPath)
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

	state, err := engine.Add(DownloadRequest{
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

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.Header.Get("Range") != "" {
			if atomic.AddInt32(&attempts, 1) == 1 {
				w.Header().Set("Retry-After", "0")
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
		handleRangeResponse(w, r, body, digest)
	}))
	defer server.Close()

	state, err := engine.Add(DownloadRequest{URL: server.URL + "/retry.bin", Filename: "retry.bin", Segments: 2})
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
	if atomic.LoadInt32(&attempts) < 2 {
		t.Fatalf("expected at least 2 segment attempts, got %d", atomic.LoadInt32(&attempts))
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
	expected := normalizeHostSettings(settings)
	if err := engine.UpdateHostSettings(settings); err != nil {
		t.Fatalf("UpdateHostSettings returned error: %v", err)
	}

	persisted, err := storage.GetHostSettings()
	if err != nil {
		t.Fatalf("GetHostSettings returned error: %v", err)
	}
	if persisted != expected {
		t.Fatalf("expected persisted settings %+v, got %+v", expected, persisted)
	}

	current := engine.HostSettings()
	if current != expected {
		t.Fatalf("expected in-memory settings %+v, got %+v", expected, current)
	}

	if engine.globalLimiter == nil {
		t.Fatal("expected global limiter to be configured")
	}
	if len(engine.slotPool) != expected.MaxConcurrentDownloads {
		t.Fatalf("expected %d available slots, got %d", expected.MaxConcurrentDownloads, len(engine.slotPool))
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
	state, err := engine.Add(DownloadRequest{
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

func waitForTerminalState(t *testing.T, storage *Storage, id string) DownloadState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state, err := storage.GetDownload(id)
		if err == nil {
			switch state.Status {
			case "finished", "error", "paused":
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
