package main

import (
	"context"
	"fmt"
	"strings"
)

// extractHLSOffer resolves an HLS manifest into a MediaOffer with Variants
// and audio/video/muxed Track entries derived from the planner's view of
// the playlist. Segment enumeration stays inside the planner.
func extractHLSOffer(ctx context.Context, candidate MediaResolveCandidate, req MediaResolveRequest) (*MediaOffer, error) {
	return extractManifestOffer(ctx, candidate, req, manifestTypeHLS)
}

// extractDASHOffer resolves a DASH MPD into a MediaOffer. Video and audio
// tracks always render as separate Track entries so the planner can fan them
// out into separate internal jobs and the mux stage combines them.
func extractDASHOffer(ctx context.Context, candidate MediaResolveCandidate, req MediaResolveRequest) (*MediaOffer, error) {
	return extractManifestOffer(ctx, candidate, req, manifestTypeDASH)
}

func extractManifestOffer(ctx context.Context, candidate MediaResolveCandidate, req MediaResolveRequest, manifestType string) (*MediaOffer, error) {
	manifest, err := resolveVideoManifest(ctx, VideoDownloadRequest{
		URL:               candidate.URL,
		ManifestType:      manifestType,
		SelectedVariantID: pickFirstNonEmpty(req.SelectedVariantID, candidate.SelectedVariant),
		Headers:           req.Headers,
		Cookies:           req.Cookies,
	})
	if err != nil {
		if isLivePlaylistError(err) {
			return &MediaOffer{
				SourceURL: candidate.URL,
				Container: strings.TrimSpace(candidate.Container),
				Debug: map[string]string{
					"live":               "true",
					"manifest_type":      manifestType,
					"live_refusal_error": err.Error(),
				},
			}, fmt.Errorf("%s manifest live and not supported", strings.ToLower(manifestType))
		}
		return nil, err
	}

	offer := &MediaOffer{
		SourceURL: candidate.URL,
		Container: manifest.Container,
		Variants:  manifest.Variants,
		Tracks:    tracksFromManifest(manifest),
		Debug: map[string]string{
			"manifest_type":       manifest.ManifestType,
			"selected_variant_id": manifest.SelectedVariantID,
		},
	}
	return offer, nil
}

func isLivePlaylistError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "live hls") || strings.Contains(msg, "live dash")
}
