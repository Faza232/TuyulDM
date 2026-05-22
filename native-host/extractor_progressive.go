package main

import (
	"context"
	"fmt"
)

// extractProgressiveOffer wraps the direct probe but only succeeds when the
// server advertises range support. Callers that need range-resumable
// downloads should prefer this extractor over extractDirectOffer.
func extractProgressiveOffer(ctx context.Context, candidate MediaResolveCandidate, headers map[string]string, cookies []RequestCookie) (probedOffer, error) {
	probed, err := extractDirectOffer(ctx, candidate, headers, cookies)
	if err != nil {
		return probedOffer{}, err
	}
	if !probed.acceptRanges {
		return probedOffer{}, fmt.Errorf("progressive extractor: server does not advertise byte ranges")
	}
	return probed, nil
}
