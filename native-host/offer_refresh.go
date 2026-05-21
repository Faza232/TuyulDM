package main

import (
	"context"
	"fmt"
	"strings"
)

// OfferRefreshRequest is the payload for the offer.refresh IPC. The caller
// passes either a new direct URL (for direct/progressive strategies) or a
// fresh candidate observation captured on the same page so an adaptive
// offer can be re-resolved against the same page graph.
type OfferRefreshRequest struct {
	DownloadID         string                `json:"id"`
	NewURL             string                `json:"url,omitempty"`
	PageURL            string                `json:"pageUrl,omitempty"`
	Candidate          MediaResolveCandidate `json:"candidate,omitempty"`
	Force              bool                  `json:"force,omitempty"`
	RestartFromScratch bool                  `json:"restartFromScratch,omitempty"`
}

// OfferRefreshResult reports whether a refreshed offer still matches the
// original asset graph, or whether the user must accept a restart because
// the asset shape changed.
type OfferRefreshResult struct {
	State              *DownloadState `json:"state,omitempty"`
	NormalizedMatch    bool           `json:"normalized_match"`
	ShapeChanged       bool           `json:"shape_changed"`
	NewOfferID         string         `json:"new_offer_id,omitempty"`
	Mismatches         []string       `json:"mismatches,omitempty"`
	RequiresPageRescan bool           `json:"requires_page_rescan,omitempty"`
}

// RefreshOffer is the offer-aware refresh entry point. Direct/progressive
// downloads route to the existing URL-replacement path. Adaptive strategies
// rerun the resolver with the supplied candidate and compare normalized
// shape against the persisted plan/offer metadata.
func (e *Engine) RefreshOffer(ctx context.Context, cache *MediaOfferCache, req OfferRefreshRequest) (*OfferRefreshResult, error) {
	state, err := e.storage.GetDownload(req.DownloadID)
	if err != nil {
		return nil, err
	}

	strategy := ExtractionStrategy(strings.TrimSpace(state.ExtractionStrategy))
	switch strategy {
	case "", StrategyDirectFile, StrategyProgressiveStream:
		if strings.TrimSpace(req.NewURL) == "" {
			return nil, fmt.Errorf("direct refresh requires a new url")
		}
		updated, err := e.RefreshURL(ctx, req.DownloadID, req.NewURL, req.Force, req.RestartFromScratch)
		if err != nil {
			return nil, err
		}
		return &OfferRefreshResult{
			State:           updated,
			NormalizedMatch: true,
		}, nil
	case StrategyHLSManifest, StrategyDASHManifest, StrategyMSEObserved, StrategyPageMetadata, StrategySiteAdapter:
		if strings.TrimSpace(req.PageURL) == "" {
			return &OfferRefreshResult{
				State:              state,
				RequiresPageRescan: true,
			}, fmt.Errorf("adaptive refresh requires a pageUrl with re-detected candidate")
		}
		offer, err := ResolveMediaOffer(ctx, MediaResolveRequest{
			PageURL:           req.PageURL,
			Candidate:         req.Candidate,
			SelectedVariantID: state.SelectedVariantID,
			Headers:           state.Headers,
			Cookies:           state.Cookies,
		})
		if err != nil {
			return nil, err
		}
		if cache != nil {
			cache.Put(offer)
		}
		mismatches := checkOfferParity(state, offer)
		result := &OfferRefreshResult{
			State:           state,
			NewOfferID:      offer.ID,
			NormalizedMatch: len(mismatches) == 0,
			ShapeChanged:    len(mismatches) > 0,
			Mismatches:      mismatches,
		}
		return result, nil
	case StrategyUnsupportedProtected:
		return nil, fmt.Errorf("protected offer cannot be refreshed")
	default:
		return nil, fmt.Errorf("refresh: unknown extraction strategy %q", strategy)
	}
}

// checkOfferParity returns the human-readable list of parity violations
// between the persisted DownloadState and a freshly resolved MediaOffer.
// An empty result means the asset shape is unchanged and resume is safe.
func checkOfferParity(state *DownloadState, offer *MediaOffer) []string {
	var mismatches []string
	if state == nil || offer == nil {
		return mismatches
	}
	if strings.TrimSpace(state.SiteKey) != "" && strings.TrimSpace(offer.SiteKey) != "" && state.SiteKey != offer.SiteKey {
		mismatches = append(mismatches, "site_key changed")
	}
	if strings.TrimSpace(state.OfferTitle) != "" && strings.TrimSpace(offer.Title) != "" && !titlesNearMatch(state.OfferTitle, offer.Title) {
		mismatches = append(mismatches, "title changed")
	}
	if strings.TrimSpace(state.VideoContainer) != "" && strings.TrimSpace(offer.Container) != "" && state.VideoContainer != offer.Container {
		mismatches = append(mismatches, "container changed")
	}
	if state.TrackCount > 0 && offerTrackCount(offer) > 0 && state.TrackCount != offerTrackCount(offer) {
		mismatches = append(mismatches, "track_count changed")
	}
	if state.ExtractionStrategy != "" && string(offer.Strategy) != "" && state.ExtractionStrategy != string(offer.Strategy) {
		mismatches = append(mismatches, "strategy changed")
	}
	return mismatches
}

func titlesNearMatch(a string, b string) bool {
	normA := strings.ToLower(strings.TrimSpace(a))
	normB := strings.ToLower(strings.TrimSpace(b))
	if normA == "" || normB == "" {
		return true
	}
	if normA == normB {
		return true
	}
	if strings.Contains(normA, normB) || strings.Contains(normB, normA) {
		return true
	}
	return false
}
