package main

import (
	"log/slog"
	"net/url"
	"path"
	"strings"
)

// RouteDecision is the output of the strategy router. Confidence is a
// 0-100 score and is only used for tie breaking / logging — the router
// always picks the highest-confidence supported strategy.
type RouteDecision struct {
	Strategy   ExtractionStrategy
	Confidence int
	Reason     string
}

// strategyConfidenceFloor maps each strategy to the baseline confidence we
// award when the candidate evidence matches that strategy at all. Higher
// strategies represent "simpler / more direct" extraction shapes.
var strategyConfidenceFloor = map[ExtractionStrategy]int{
	StrategyDirectFile:           95,
	StrategyProgressiveStream:    90,
	StrategyHLSManifest:          80,
	StrategyDASHManifest:         80,
	StrategyMSEObserved:          60,
	StrategyPageMetadata:         50,
	StrategySiteAdapter:          40,
	StrategyUnsupportedProtected: 100, // hard precedence when evidence flags DRM
}

// RouteExtractionStrategy picks the cheapest reliable extraction strategy
// for a candidate. Routing is deterministic for a given input — same
// candidate + evidence always yields the same decision.
func RouteExtractionStrategy(candidate MediaResolveCandidate, evidence *DetectedEvidence) RouteDecision {
	if candidate.Protected {
		return RouteDecision{
			Strategy:   StrategyUnsupportedProtected,
			Confidence: strategyConfidenceFloor[StrategyUnsupportedProtected],
			Reason:     "candidate marked protected",
		}
	}

	if evidence != nil && evidenceImpliesProtected(*evidence) {
		return RouteDecision{
			Strategy:   StrategyUnsupportedProtected,
			Confidence: strategyConfidenceFloor[StrategyUnsupportedProtected],
			Reason:     "evidence implies DRM",
		}
	}

	manifestHint := strings.ToUpper(strings.TrimSpace(candidate.ManifestType))
	if manifestHint == "" && evidence != nil {
		manifestHint = strings.ToUpper(strings.TrimSpace(evidence.ManifestType))
	}
	kindHint := strings.ToLower(strings.TrimSpace(candidate.Kind))
	mimeHint := strings.ToLower(pickFirstNonEmpty(candidate.MimeType, evidenceContentType(evidence)))

	switch manifestHint {
	case manifestTypeHLS:
		return RouteDecision{
			Strategy:   StrategyHLSManifest,
			Confidence: strategyConfidenceFloor[StrategyHLSManifest] + 10,
			Reason:     "manifest hint=HLS",
		}
	case manifestTypeDASH:
		return RouteDecision{
			Strategy:   StrategyDASHManifest,
			Confidence: strategyConfidenceFloor[StrategyDASHManifest] + 10,
			Reason:     "manifest hint=DASH",
		}
	}

	if kindHint == "progressive_mp4" || kindHint == "progressive" {
		return RouteDecision{
			Strategy:   StrategyProgressiveStream,
			Confidence: strategyConfidenceFloor[StrategyProgressiveStream] + 5,
			Reason:     "kind hint=" + kindHint,
		}
	}

	if isDirectMediaMime(mimeHint) {
		return RouteDecision{
			Strategy:   StrategyDirectFile,
			Confidence: strategyConfidenceFloor[StrategyDirectFile],
			Reason:     "mime=" + mimeHint,
		}
	}

	lowerURL := strings.ToLower(candidate.URL)
	if extHint := urlExtension(lowerURL); extHint != "" {
		switch extHint {
		case "m3u8":
			return RouteDecision{Strategy: StrategyHLSManifest, Confidence: strategyConfidenceFloor[StrategyHLSManifest], Reason: "ext=.m3u8"}
		case "mpd":
			return RouteDecision{Strategy: StrategyDASHManifest, Confidence: strategyConfidenceFloor[StrategyDASHManifest], Reason: "ext=.mpd"}
		case "mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "aac", "flac", "wav":
			confidence := strategyConfidenceFloor[StrategyDirectFile]
			if evidence != nil && evidence.SawRangeRequests {
				confidence += 2
			}
			return RouteDecision{Strategy: StrategyDirectFile, Confidence: confidence, Reason: "ext=" + extHint}
		}
	}

	if evidence != nil {
		if evidence.SawBlobPlayback && evidence.HadAudioVideoTraffic {
			return RouteDecision{
				Strategy:   StrategyMSEObserved,
				Confidence: strategyConfidenceFloor[StrategyMSEObserved],
				Reason:     "mse: blob playback + a/v traffic",
			}
		}
		if evidence.SawRangeRequests {
			return RouteDecision{
				Strategy:   StrategyProgressiveStream,
				Confidence: strategyConfidenceFloor[StrategyProgressiveStream] - 10,
				Reason:     "evidence: range requests",
			}
		}
	}

	return RouteDecision{
		Strategy:   StrategyDirectFile,
		Confidence: 30,
		Reason:     "fallback default",
	}
}

func evidenceImpliesProtected(evidence DetectedEvidence) bool {
	mime := strings.ToLower(strings.TrimSpace(evidence.ContentType))
	switch {
	case strings.Contains(mime, "application/vnd.ms-sstr+xml"),
		strings.Contains(mime, "application/widevine"):
		return true
	}
	return false
}

func evidenceContentType(evidence *DetectedEvidence) string {
	if evidence == nil {
		return ""
	}
	return evidence.ContentType
}

func isDirectMediaMime(mime string) bool {
	if mime == "" {
		return false
	}
	switch {
	case strings.HasPrefix(mime, "video/"),
		strings.HasPrefix(mime, "audio/"):
		// HLS / DASH mimes already handled above via manifest hint
		return !strings.Contains(mime, "mpegurl") && !strings.Contains(mime, "dash+xml")
	case strings.HasPrefix(mime, "application/octet-stream"):
		return true
	}
	return false
}

func urlExtension(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(parsed.Path), "."))
	return ext
}

func logRouteDecision(siteKey string, candidate MediaResolveCandidate, decision RouteDecision) {
	slog.Info("media_route_selected",
		"event", "media_route_selected",
		"strategy", string(decision.Strategy),
		"site_key", siteKey,
		"confidence", decision.Confidence,
		"reason", decision.Reason,
		"candidate_url", candidate.URL,
	)
}
