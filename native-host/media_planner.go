package main

import (
	"fmt"
	"strings"
)

// PlanStep is one internal action the engine takes to satisfy a MediaOffer.
// Segments are an implementation detail of the engine, never exposed as
// PlanSteps.
type PlanStep struct {
	Kind        string `json:"kind"` // file, hls_track, dash_track, mux, remux
	TrackID     string `json:"track_id,omitempty"`
	URL         string `json:"url,omitempty"`
	ManifestURL string `json:"manifest_url,omitempty"`
	Container   string `json:"container,omitempty"`
}

// DownloadPlan captures the engine's interpretation of a MediaOffer. It is
// persisted on DownloadState so refresh/resume can reacquire the same asset
// shape after restart.
type DownloadPlan struct {
	OfferID        string     `json:"offer_id,omitempty"`
	Strategy       string     `json:"strategy"`
	FinalContainer string     `json:"final_container"`
	Steps          []PlanStep `json:"steps"`
}

// Assembly stage values stamped on DownloadState while the engine progresses
// from offer resolution to final remux. Stage values are surfaced to the UI
// so users see why an adaptive job is muxing instead of merely downloading.
const (
	AssemblyStageResolving  = "resolving"
	AssemblyStageFetching   = "fetching"
	AssemblyStageMuxing     = "muxing"
	AssemblyStageRemuxing   = "remuxing"
	AssemblyStageFinalizing = "finalizing"
)

// PlanFromOffer translates an offer into the engine's normalized plan. The
// translation is deterministic — the same offer always produces the same
// plan shape — so persistence + resume can rely on it.
func PlanFromOffer(offer *MediaOffer) (*DownloadPlan, error) {
	if offer == nil {
		return nil, fmt.Errorf("offer is nil")
	}

	plan := &DownloadPlan{
		OfferID:        offer.ID,
		Strategy:       string(offer.Strategy),
		FinalContainer: pickFirstNonEmpty(offer.Container, "mp4"),
	}

	switch offer.Strategy {
	case StrategyDirectFile, StrategyProgressiveStream:
		plan.Steps = []PlanStep{{
			Kind:      "file",
			TrackID:   "main",
			URL:       offer.SourceURL,
			Container: offer.Container,
		}}
	case StrategyHLSManifest, StrategyMSEObserved:
		plan.Steps = []PlanStep{{
			Kind:        "hls_track",
			TrackID:     "muxed",
			ManifestURL: offer.SourceURL,
			Container:   offer.Container,
		}, {
			Kind:      "remux",
			Container: plan.FinalContainer,
		}}
	case StrategyDASHManifest:
		for _, track := range offer.Tracks {
			if track.Kind == "muxed" {
				continue
			}
			plan.Steps = append(plan.Steps, PlanStep{
				Kind:        "dash_track",
				TrackID:     track.ID,
				ManifestURL: offer.SourceURL,
				Container:   track.Container,
			})
		}
		if len(plan.Steps) == 0 {
			plan.Steps = append(plan.Steps, PlanStep{
				Kind:        "dash_track",
				TrackID:     "muxed",
				ManifestURL: offer.SourceURL,
				Container:   offer.Container,
			})
		}
		plan.Steps = append(plan.Steps, PlanStep{Kind: "mux", Container: plan.FinalContainer})
	case StrategyPageMetadata, StrategySiteAdapter:
		for _, track := range offer.Tracks {
			plan.Steps = append(plan.Steps, PlanStep{
				Kind:        offerTrackPlanKind(offer, track),
				TrackID:     track.ID,
				URL:         track.URL,
				ManifestURL: track.ManifestURL,
				Container:   track.Container,
			})
		}
		if len(plan.Steps) > 1 {
			plan.Steps = append(plan.Steps, PlanStep{Kind: "mux", Container: plan.FinalContainer})
		}
	case StrategyUnsupportedProtected:
		return nil, fmt.Errorf("offer is protected: %s", offer.ProtectedReason)
	default:
		return nil, fmt.Errorf("planner: unknown strategy %q", offer.Strategy)
	}

	return plan, nil
}

func offerTrackPlanKind(offer *MediaOffer, track MediaTrack) string {
	if strings.TrimSpace(track.ManifestURL) != "" {
		switch offer.Strategy {
		case StrategyDASHManifest:
			return "dash_track"
		case StrategyHLSManifest, StrategyMSEObserved:
			return "hls_track"
		}
	}
	return "file"
}
