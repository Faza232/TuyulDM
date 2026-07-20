package main

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Live tests hit real YouTube + network and are gated behind TUYULDM_LIVE_YT=1
// so normal `go test` stays hermetic. Run with:
//
//	TUYULDM_LIVE_YT=1 go test -run TestLiveYouTube -v
func requireLiveYT(t *testing.T) {
	t.Helper()
	if os.Getenv("TUYULDM_LIVE_YT") == "" {
		t.Skip("set TUYULDM_LIVE_YT=1 to run live YouTube tests")
	}
}

// Resolution-only: first YouTube video ("Me at the zoo"), always available.
func TestLiveYouTube(t *testing.T) {
	requireLiveYT(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	m, err := resolveYouTubeManifest(ctx, VideoDownloadRequest{
		URL: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	var video, audio int
	for _, s := range m.Segments {
		switch s.Track {
		case "video":
			video++
		case "audio":
			audio++
		}
	}
	t.Logf("variants=%d segments=%d (video=%d audio=%d) selected=%s",
		len(m.Variants), len(m.Segments), video, audio, m.SelectedVariantID)
	if video == 0 {
		t.Fatal("no video segments")
	}
	first := m.Segments[0].URL
	if !strings.Contains(first, "range=") || !strings.Contains(first, "googlevideo.com") {
		t.Fatalf("segment url missing range/googlevideo: %s", first)
	}
}

// Full pipeline: resolve -> download fragments -> concat -> ffmpeg mux ->
// playable mp4 verified with ffprobe.
func TestLiveYouTubeDownload(t *testing.T) {
	requireLiveYT(t)
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("no ffmpeg")
	}
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	t.Setenv("TUYULDM_FFMPEG", ffmpeg)

	downloadDir := t.TempDir()
	storage := newTestStorage(t)
	if err := storage.SaveHostSettings(HostSettings{DownloadDir: downloadDir}); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	engine := NewEngine(storage, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	state, err := engine.AddVideo(ctx, VideoDownloadRequest{
		URL:          "https://www.youtube.com/watch?v=jNQXAC9IVRw",
		Filename:     "zoo.mp4",
		ManifestType: manifestTypeYouTube,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if err := engine.Start(state.ID); err != nil {
		t.Fatalf("start: %v", err)
	}

	final := waitForTerminalStateWithin(t, storage, state.ID, 80*time.Second)
	if final.Status != "finished" {
		t.Fatalf("status=%q err=%s", final.Status, final.Error)
	}
	info, err := os.Stat(final.OutputPath)
	if err != nil {
		t.Fatalf("stat output: %v", err)
	}
	t.Logf("output=%s size=%d", final.OutputPath, info.Size())
	if info.Size() < 50_000 {
		t.Fatalf("output too small: %d", info.Size())
	}

	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		return
	}
	out, err := exec.Command(ffprobe, "-v", "error", "-show_entries",
		"stream=codec_type", "-of", "csv=p=0", final.OutputPath).CombinedOutput()
	if err != nil {
		t.Fatalf("ffprobe failed: %v\n%s", err, out)
	}
	streams := string(out)
	t.Logf("ffprobe streams: %s", strings.ReplaceAll(strings.TrimSpace(streams), "\n", ","))
	if !strings.Contains(streams, "video") {
		t.Fatalf("no video stream: %s", streams)
	}
	if !strings.Contains(streams, "audio") {
		t.Errorf("no audio stream: %s", streams)
	}
}
