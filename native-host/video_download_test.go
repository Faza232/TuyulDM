package main

import (
	"context"
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

func TestEngineVideoDownloadUsesParallelSegmentFetches(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	ffmpegPath := filepath.Join(t.TempDir(), "fake-ffmpeg")
	if err := os.WriteFile(ffmpegPath, []byte(`#!/bin/sh
input=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-i" ] && [ -z "$input" ]; then
    input="$arg"
  fi
  prev="$arg"
  out="$arg"
done
cp "$input" "$out"
`), 0o755); err != nil {
		t.Fatalf("failed to write fake ffmpeg: %v", err)
	}
	t.Setenv("TUYULDM_FFMPEG", ffmpegPath)

	storage := newTestStorage(t)
	engine := NewEngine(storage, nil)

	segments := map[string]string{
		"/seg-1.ts": "first-",
		"/seg-2.ts": "second-",
		"/seg-3.ts": "third-",
		"/seg-4.ts": "fourth",
	}
	var inflight int32
	var maxInflight int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/playlist.m3u8":
			_, _ = w.Write([]byte(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXTINF:2,
seg-1.ts
#EXTINF:2,
seg-2.ts
#EXTINF:2,
seg-3.ts
#EXTINF:2,
seg-4.ts
#EXT-X-ENDLIST
`))
		case "/seg-1.ts", "/seg-2.ts", "/seg-3.ts", "/seg-4.ts":
			current := atomic.AddInt32(&inflight, 1)
			for {
				observed := atomic.LoadInt32(&maxInflight)
				if current <= observed || atomic.CompareAndSwapInt32(&maxInflight, observed, current) {
					break
				}
			}
			time.Sleep(40 * time.Millisecond)
			_, _ = w.Write([]byte(segments[r.URL.Path]))
			atomic.AddInt32(&inflight, -1)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	state, err := engine.AddVideo(context.Background(), VideoDownloadRequest{
		URL:          server.URL + "/playlist.m3u8",
		Filename:     "demo-video.mp4",
		ManifestType: manifestTypeHLS,
		Segments:     4,
	})
	if err != nil {
		t.Fatalf("AddVideo returned error: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	final := waitForTerminalState(t, storage, state.ID)
	if final.Status != "finished" {
		t.Fatalf("expected finished video download, got %q (%s)", final.Status, final.Error)
	}
	if atomic.LoadInt32(&maxInflight) < 2 {
		t.Fatalf("expected parallel segment fetches, saw max inflight=%d", atomic.LoadInt32(&maxInflight))
	}

	body, err := os.ReadFile(final.OutputPath)
	if err != nil {
		t.Fatalf("failed to read output file: %v", err)
	}
	expected := strings.Join([]string{"first-", "second-", "third-", "fourth"}, "")
	if string(body) != expected {
		t.Fatalf("unexpected muxed output: got %q want %q", string(body), expected)
	}
	if final.TotalSize != int64(len(expected)) {
		t.Fatalf("expected output size %d, got %d", len(expected), final.TotalSize)
	}
	if filepath.Ext(final.Filename) != ".mp4" {
		t.Fatalf("expected mp4 output filename, got %q", final.Filename)
	}
	if final.Progress != 100 {
		t.Fatalf("expected 100%% progress, got %.2f", final.Progress)
	}

	segmentDir := filepath.Join(filepath.Dir(final.OutputPath), ".segments", final.ID)
	if _, err := os.Stat(segmentDir); !os.IsNotExist(err) {
		t.Fatalf("expected segment work dir cleanup, got stat err=%v", err)
	}

	for index := range final.Segments {
		if !final.Segments[index].Completed {
			t.Fatalf("expected segment %d completed", index)
		}
	}
	if final.SelectedVariantID != "hls-direct" {
		t.Fatalf("expected direct hls variant id, got %q", final.SelectedVariantID)
	}
	if final.ManifestType != manifestTypeHLS {
		t.Fatalf("expected HLS manifest type, got %q", final.ManifestType)
	}
	if final.Parallelism != 4 {
		t.Fatalf("expected stored video parallelism 4, got %d", final.Parallelism)
	}
	if got := fmt.Sprintf("%d", len(final.Variants)); got != "1" {
		t.Fatalf("expected one direct variant, got %s", got)
	}
}