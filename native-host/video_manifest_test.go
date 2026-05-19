package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveVideoManifestHLSSelectsHighestBandwidthVariant(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/master.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=640000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720
high/index.m3u8
`))
		case "/high/index.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte(`#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:5.005,
segment-1.m4s
#EXTINF:5.005,
segment-2.m4s
#EXT-X-ENDLIST
`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	manifest, err := resolveVideoManifest(context.Background(), VideoDownloadRequest{
		URL:          server.URL + "/master.m3u8",
		ManifestType: manifestTypeHLS,
	})
	if err != nil {
		t.Fatalf("resolveVideoManifest returned error: %v", err)
	}

	if manifest.ManifestType != manifestTypeHLS {
		t.Fatalf("expected HLS manifest type, got %q", manifest.ManifestType)
	}
	if manifest.SelectedVariantID != "hls-1" {
		t.Fatalf("expected highest bandwidth variant hls-1, got %q", manifest.SelectedVariantID)
	}
	if len(manifest.Variants) != 2 {
		t.Fatalf("expected 2 variants, got %d", len(manifest.Variants))
	}
	if manifest.Container != "mp4" {
		t.Fatalf("expected mp4 container, got %q", manifest.Container)
	}
	if len(manifest.Segments) != 3 {
		t.Fatalf("expected map plus 2 media segments, got %d", len(manifest.Segments))
	}
	if manifest.Segments[0].Track != "muxed" || manifest.Segments[0].URL != server.URL+"/high/init.mp4" {
		t.Fatalf("unexpected init segment: %+v", manifest.Segments[0])
	}
	if manifest.Segments[1].URL != server.URL+"/high/segment-1.m4s" {
		t.Fatalf("unexpected first media segment url: %q", manifest.Segments[1].URL)
	}
}

func TestResolveVideoManifestRejectsProtectedHLS(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"
#EXTINF:6,
segment.ts
#EXT-X-ENDLIST
`))
	}))
	defer server.Close()

	_, err := resolveVideoManifest(context.Background(), VideoDownloadRequest{
		URL:          server.URL,
		ManifestType: manifestTypeHLS,
	})
	if err == nil {
		t.Fatal("expected protected HLS manifest to fail")
	}
}

func TestResolveVideoManifestDASHBuildsVideoAndAudioTracks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<?xml version="1.0"?>
<MPD type="static" mediaPresentationDuration="PT6S" xmlns="urn:mpeg:dash:schema:mpd:2011">
  <BaseURL>/vod/</BaseURL>
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="video-low" bandwidth="640000" width="640" height="360" codecs="avc1.4d401f">
        <SegmentTemplate initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/chunk-$Number$.m4s" timescale="1" duration="2" startNumber="1" />
      </Representation>
      <Representation id="video-high" bandwidth="1280000" width="1280" height="720" codecs="avc1.4d401f">
        <SegmentTemplate initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/chunk-$Number$.m4s" timescale="1" duration="2" startNumber="1" />
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="audio-main" bandwidth="128000" codecs="mp4a.40.2">
        <SegmentTemplate initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/chunk-$Number$.m4s" timescale="1" duration="2" startNumber="1" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`))
	}))
	defer server.Close()

	manifest, err := resolveVideoManifest(context.Background(), VideoDownloadRequest{
		URL:          server.URL,
		ManifestType: manifestTypeDASH,
	})
	if err != nil {
		t.Fatalf("resolveVideoManifest returned error: %v", err)
	}

	if manifest.ManifestType != manifestTypeDASH {
		t.Fatalf("expected DASH manifest type, got %q", manifest.ManifestType)
	}
	if manifest.SelectedVariantID != "video-high" {
		t.Fatalf("expected highest bandwidth dash variant, got %q", manifest.SelectedVariantID)
	}
	if manifest.Container != "mp4" {
		t.Fatalf("expected mp4 container, got %q", manifest.Container)
	}
	if len(manifest.Variants) != 2 {
		t.Fatalf("expected 2 dash variants, got %d", len(manifest.Variants))
	}
	if len(manifest.Segments) != 8 {
		t.Fatalf("expected video and audio init/media segments, got %d", len(manifest.Segments))
	}
	if manifest.Segments[0].Track != "video" || manifest.Segments[0].URL != server.URL+"/vod/video-high/init.mp4" {
		t.Fatalf("unexpected first dash segment: %+v", manifest.Segments[0])
	}
	if manifest.Segments[4].Track != "audio" || manifest.Segments[4].URL != server.URL+"/vod/audio-main/init.mp4" {
		t.Fatalf("unexpected first dash audio segment: %+v", manifest.Segments[4])
	}
}

func TestResolveVideoManifestRejectsProtectedDASH(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<?xml version="1.0"?>
<MPD type="static" xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" />
      <Representation id="video-high" bandwidth="1280000" codecs="avc1.4d401f">
        <SegmentTemplate initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/chunk-$Number$.m4s" timescale="1" duration="2" startNumber="1" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`))
	}))
	defer server.Close()

	_, err := resolveVideoManifest(context.Background(), VideoDownloadRequest{
		URL:          server.URL,
		ManifestType: manifestTypeDASH,
	})
	if err == nil {
		t.Fatal("expected protected DASH manifest to fail")
	}
}