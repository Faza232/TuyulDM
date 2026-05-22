package main

import (
	"context"
	"errors"
	"strings"
)

// errPageMetadataNotAvailable signals that the candidate routed to
// page_metadata strategy but no captured page payload was supplied. The
// router/resolver caller should fall back to another strategy.
var errPageMetadataNotAvailable = errors.New("page_metadata extractor: no captured page snapshot supplied")

// extractPageMetadataOffer parses pre-captured browser-side page HTML or
// structured player payload from the candidate. Phase R supplies the parser
// surface but only succeeds when the candidate already carries enough
// metadata (title + container + URL) — full inline-script parsers will be
// filled in by later phases / site adapters.
func extractPageMetadataOffer(_ context.Context, candidate MediaResolveCandidate) (*MediaOffer, error) {
	title := strings.TrimSpace(candidate.Title)
	container := strings.TrimSpace(candidate.Container)
	if title == "" && container == "" {
		return nil, errPageMetadataNotAvailable
	}

	offer := &MediaOffer{
		SourceURL: candidate.URL,
		Title:     title,
		Container: container,
		Tracks: []MediaTrack{{
			ID:        "main",
			Kind:      "muxed",
			URL:       candidate.URL,
			Container: container,
		}},
		Debug: map[string]string{
			"source": "page_metadata",
		},
	}
	return offer, nil
}
