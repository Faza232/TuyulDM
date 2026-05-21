package main

import "testing"

func TestRouteExtractionStrategy_ProtectedShortCircuits(t *testing.T) {
	decision := RouteExtractionStrategy(MediaResolveCandidate{
		URL:       "https://example.com/movie.m3u8",
		Protected: true,
	}, nil)
	if decision.Strategy != StrategyUnsupportedProtected {
		t.Fatalf("expected unsupported_protected, got %q", decision.Strategy)
	}
}

func TestRouteExtractionStrategy_HLSHint(t *testing.T) {
	decision := RouteExtractionStrategy(MediaResolveCandidate{
		URL:          "https://example.com/index.m3u8",
		ManifestType: "HLS",
	}, nil)
	if decision.Strategy != StrategyHLSManifest {
		t.Fatalf("expected hls_manifest, got %q", decision.Strategy)
	}
}

func TestRouteExtractionStrategy_DirectMP4DoesNotRouteToManifest(t *testing.T) {
	decision := RouteExtractionStrategy(MediaResolveCandidate{
		URL: "https://example.com/big-buck-bunny.mp4",
	}, nil)
	if decision.Strategy != StrategyDirectFile {
		t.Fatalf("expected direct_file for plain mp4, got %q", decision.Strategy)
	}
}

func TestRouteExtractionStrategy_DASHHintBeatsURL(t *testing.T) {
	// MPD url + DASH hint must resolve as DASH adaptive plan, not raw segment list.
	decision := RouteExtractionStrategy(MediaResolveCandidate{
		URL:          "https://example.com/stream.mpd",
		ManifestType: "DASH",
	}, nil)
	if decision.Strategy != StrategyDASHManifest {
		t.Fatalf("expected dash_manifest, got %q", decision.Strategy)
	}
}

func TestRouteExtractionStrategy_DeterministicSameInput(t *testing.T) {
	candidate := MediaResolveCandidate{URL: "https://cdn.example.com/movie.m3u8", ManifestType: "HLS"}
	first := RouteExtractionStrategy(candidate, nil)
	second := RouteExtractionStrategy(candidate, nil)
	if first != second {
		t.Fatalf("router non-deterministic: %+v vs %+v", first, second)
	}
}

func TestRouteExtractionStrategy_MimeFallback(t *testing.T) {
	decision := RouteExtractionStrategy(MediaResolveCandidate{
		URL:      "https://example.com/play",
		MimeType: "video/mp4",
	}, nil)
	if decision.Strategy != StrategyDirectFile {
		t.Fatalf("expected direct_file from mime hint, got %q", decision.Strategy)
	}
}

func TestRouteExtractionStrategy_EvidenceMSE(t *testing.T) {
	decision := RouteExtractionStrategy(MediaResolveCandidate{
		URL: "https://example.com/player",
	}, &DetectedEvidence{
		SawBlobPlayback:      true,
		HadAudioVideoTraffic: true,
	})
	if decision.Strategy != StrategyMSEObserved {
		t.Fatalf("expected mse_observed_manifest, got %q", decision.Strategy)
	}
}
