package main

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestEngineQueuesDownloadsByConcurrencyCap(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	if err := storage.SaveHostSettings(HostSettings{MaxConcurrentDownloads: 1}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("queue-behavior-", 256))
	digest := md5.Sum(body)
	gate := make(chan struct{})
	var inflight int32
	var maxInflight int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(digest[:]))
			w.Header().Set("ETag", `"queue-test"`)
			w.WriteHeader(http.StatusOK)
			return
		}

		current := atomic.AddInt32(&inflight, 1)
		for {
			observed := atomic.LoadInt32(&maxInflight)
			if current <= observed || atomic.CompareAndSwapInt32(&maxInflight, observed, current) {
				break
			}
		}

		select {
		case <-gate:
		case <-time.After(2 * time.Second):
			http.Error(w, "timed out waiting for test gate", http.StatusGatewayTimeout)
			atomic.AddInt32(&inflight, -1)
			return
		}
		handleRangeResponse(w, r, body, digest)
		atomic.AddInt32(&inflight, -1)
	}))
	defer server.Close()

	var ids []string
	for index := 0; index < 3; index++ {
		state, err := engine.Add(context.Background(), DownloadRequest{
			URL:      server.URL + "/file.bin",
			Filename: fmt.Sprintf("queued-%d.bin", index),
			Segments: 1,
		})
		if err != nil {
			t.Fatalf("Add returned error: %v", err)
		}
		ids = append(ids, state.ID)
	}

	for _, id := range ids {
		if err := engine.Start(id); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}
	}

	waitForStatusCounts(t, storage, ids, map[string]int{"downloading": 1, "queued": 2})
	close(gate)

	for _, id := range ids {
		state := waitForTerminalState(t, storage, id)
		if state.Status != "finished" {
			t.Fatalf("expected finished download, got %q (%s)", state.Status, state.Error)
		}
	}

	if atomic.LoadInt32(&maxInflight) != 1 {
		t.Fatalf("expected max inflight requests of 1, got %d", atomic.LoadInt32(&maxInflight))
	}
}

func TestResumeAllDownloadsIgnoresPausedAlreadyActiveRace(t *testing.T) {
	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)
	state := &DownloadState{
		ID:            "paused-active",
		Filename:      "race.bin",
		Status:        "paused",
		Type:          "file",
		CreatedAt:     time.Now(),
		WasUserPaused: true,
	}
	if err := storage.SaveDownload(state); err != nil {
		t.Fatalf("SaveDownload returned error: %v", err)
	}

	engine.mu.Lock()
	engine.active[state.ID] = &ActiveDownload{
		State:  cloneDownloadStatePtr(state),
		Ctx:    context.Background(),
		Cancel: func() {},
		Done:   make(chan struct{}),
	}
	engine.mu.Unlock()

	if err := resumeAllDownloads(context.Background(), engine, []DownloadState{{ID: state.ID, Status: "paused"}}); err != nil {
		t.Fatalf("resumeAllDownloads returned error: %v", err)
	}

	updated, err := storage.GetDownload(state.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if updated.WasUserPaused {
		t.Fatal("expected WasUserPaused to be cleared during resume-all")
	}
}

func TestEngineShutdownDoesNotStartQueuedDownloads(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	storage := newTestStorage(t)
	if err := storage.SaveHostSettings(HostSettings{MaxConcurrentDownloads: 1}); err != nil {
		t.Fatalf("SaveHostSettings returned error: %v", err)
	}
	engine := NewEngine(storage, nil)
	body := []byte(strings.Repeat("shutdown-queue-", 64))
	digest := md5.Sum(body)
	var started int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-MD5", base64.StdEncoding.EncodeToString(digest[:]))
			w.Header().Set("ETag", `"shutdown-queue-test"`)
			w.WriteHeader(http.StatusOK)
			return
		}

		atomic.AddInt32(&started, 1)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
		w.WriteHeader(http.StatusOK)
		<-r.Context().Done()
	}))
	defer server.Close()

	first, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/one.bin", Filename: "one.bin", Segments: 1})
	if err != nil {
		t.Fatalf("first Add returned error: %v", err)
	}
	second, err := engine.Add(context.Background(), DownloadRequest{URL: server.URL + "/two.bin", Filename: "two.bin", Segments: 1})
	if err != nil {
		t.Fatalf("second Add returned error: %v", err)
	}
	if err := engine.Start(first.ID); err != nil {
		t.Fatalf("first Start returned error: %v", err)
	}
	if err := engine.Start(second.ID); err != nil {
		t.Fatalf("second Start returned error: %v", err)
	}

	waitForStatusCounts(t, storage, []string{first.ID, second.ID}, map[string]int{"downloading": 1, "queued": 1})

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := engine.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("Shutdown returned error: %v", err)
	}

	updated, err := storage.GetDownload(second.ID)
	if err != nil {
		t.Fatalf("GetDownload returned error: %v", err)
	}
	if updated.Status != "queued" {
		t.Fatalf("expected queued download to stay queued during shutdown, got %q", updated.Status)
	}
	if atomic.LoadInt32(&started) != 1 {
		t.Fatalf("expected only active download to start before shutdown, got %d starts", atomic.LoadInt32(&started))
	}
}

func cloneDownloadStatePtr(state *DownloadState) *DownloadState {
	clone := cloneDownloadState(state)
	return &clone
}

func waitForStatusCounts(t *testing.T, storage *Storage, ids []string, expected map[string]int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		counts := make(map[string]int)
		allPresent := true
		for _, id := range ids {
			state, err := storage.GetDownload(id)
			if err != nil {
				allPresent = false
				break
			}
			counts[state.Status]++
		}
		if allPresent {
			matched := true
			for status, count := range expected {
				if counts[status] != count {
					matched = false
					break
				}
			}
			if matched {
				return
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for status counts: %#v", expected)
}
