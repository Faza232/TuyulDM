package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

// extractDirectOffer probes a candidate URL with a HEAD request to confirm it
// looks like a stable downloadable file. Returns a single-track MediaOffer.
// On HTML responses or unknown shapes returns an error so the router can fall
// through to the next strategy.
func extractDirectOffer(ctx context.Context, candidate MediaResolveCandidate, headers map[string]string, cookies []RequestCookie) (probedOffer, error) {
	if strings.TrimSpace(candidate.URL) == "" {
		return probedOffer{}, fmt.Errorf("direct extractor: empty url")
	}

	resp, finalURL, err := doRequestWithRedirects(ctx, http.MethodHead, candidate.URL, headers, cookies, nil)
	if err != nil {
		return probedOffer{}, err
	}
	meta := metadataFromResponse(finalURL, resp)
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	_ = resp.Body.Close()

	if resp.StatusCode >= 400 {
		return probedOffer{}, fmt.Errorf("direct extractor: status %d", resp.StatusCode)
	}
	if strings.HasPrefix(contentType, "text/html") {
		return probedOffer{}, fmt.Errorf("direct extractor: html response (%s)", contentType)
	}

	container := containerFromContentType(contentType)
	if container == "" {
		container = strings.TrimPrefix(urlExtension(finalURL), ".")
	}

	offer := &MediaOffer{
		SourceURL: finalURL,
		Container: container,
		MimeType:  strings.TrimSpace(resp.Header.Get("Content-Type")),
		Tracks: []MediaTrack{{
			ID:        "main",
			Kind:      "muxed",
			URL:       finalURL,
			Container: container,
		}},
	}

	return probedOffer{
		offer:        offer,
		acceptRanges: meta.AcceptRanges,
		totalSize:    meta.TotalSize,
	}, nil
}

type probedOffer struct {
	offer        *MediaOffer
	acceptRanges bool
	totalSize    int64
}

func containerFromContentType(contentType string) string {
	mime := strings.ToLower(strings.TrimSpace(contentType))
	switch {
	case strings.HasPrefix(mime, "video/mp4"):
		return "mp4"
	case strings.HasPrefix(mime, "video/webm"):
		return "webm"
	case strings.HasPrefix(mime, "video/x-matroska"):
		return "mkv"
	case strings.HasPrefix(mime, "video/quicktime"):
		return "mov"
	case strings.HasPrefix(mime, "audio/mpeg"):
		return "mp3"
	case strings.HasPrefix(mime, "audio/mp4"):
		return "m4a"
	case strings.HasPrefix(mime, "audio/wav"):
		return "wav"
	}
	return ""
}
