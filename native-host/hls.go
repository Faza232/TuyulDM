package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/grafov/m3u8"
)

func parseHLSManifest(ctx context.Context, manifestURL string, rawManifest string, req VideoDownloadRequest) (*VideoManifest, error) {
	playlist, listType, err := m3u8.DecodeFrom(strings.NewReader(rawManifest), true)
	if err != nil {
		return nil, err
	}

	manifest := &VideoManifest{ManifestType: manifestTypeHLS}

	switch listType {
	case m3u8.MASTER:
		master := playlist.(*m3u8.MasterPlaylist)
		if len(master.Variants) == 0 {
			return nil, fmt.Errorf("hls master playlist had no variants")
		}

		selectedIndex := 0
		selectedBandwidth := int64(-1)
		for index, variant := range master.Variants {
			if variant == nil {
				continue
			}

			variantID := fmt.Sprintf("hls-%d", index)
			manifest.Variants = append(manifest.Variants, VideoVariant{
				ID:         variantID,
				Name:       strings.TrimSpace(variant.VariantParams.Name),
				Bandwidth:  int64(variant.VariantParams.Bandwidth),
				Resolution: strings.TrimSpace(variant.VariantParams.Resolution),
				Codecs:     strings.TrimSpace(variant.VariantParams.Codecs),
				URL:        resolveVideoURL(manifestURL, variant.URI),
			})

			if req.SelectedVariantID != "" && req.SelectedVariantID == variantID {
				selectedIndex = index
				selectedBandwidth = int64(variant.VariantParams.Bandwidth)
				continue
			}

			if req.SelectedVariantID == "" && int64(variant.VariantParams.Bandwidth) > selectedBandwidth {
				selectedIndex = index
				selectedBandwidth = int64(variant.VariantParams.Bandwidth)
			}
		}

		if req.SelectedVariantID != "" && (selectedIndex >= len(master.Variants) || manifest.Variants[selectedIndex].ID != req.SelectedVariantID) {
			return nil, fmt.Errorf("requested hls variant %q not found", req.SelectedVariantID)
		}

		selectedVariant := manifest.Variants[selectedIndex]
		if selectedVariant.Name == "" {
			selectedVariant.Name = variantNameFromURL(selectedVariant.URL)
			manifest.Variants[selectedIndex].Name = selectedVariant.Name
		}
		manifest.SelectedVariantID = selectedVariant.ID

		childRawManifest, childURL, err := fetchManifest(ctx, selectedVariant.URL, req.Headers, req.Cookies)
		if err != nil {
			return nil, err
		}
		return populateHLSMediaManifest(childURL, childRawManifest, manifest)

	case m3u8.MEDIA:
		manifest.Variants = []VideoVariant{{
			ID:   "hls-direct",
			Name: variantNameFromURL(manifestURL),
			URL:  manifestURL,
		}}
		manifest.SelectedVariantID = manifest.Variants[0].ID
		return populateHLSMediaManifest(manifestURL, rawManifest, manifest)

	default:
		return nil, fmt.Errorf("unsupported hls playlist type %d", listType)
	}
}

func populateHLSMediaManifest(manifestURL string, rawManifest string, manifest *VideoManifest) (*VideoManifest, error) {
	if err := rejectProtectedHLS(rawManifest); err != nil {
		return nil, err
	}

	playlist, listType, err := m3u8.DecodeFrom(strings.NewReader(rawManifest), true)
	if err != nil {
		return nil, err
	}
	if listType != m3u8.MEDIA {
		return nil, fmt.Errorf("expected hls media playlist")
	}

	media := playlist.(*m3u8.MediaPlaylist)
	if !media.Closed {
		return nil, fmt.Errorf("live hls playlists are not supported yet")
	}

	manifest.Container = detectHLSContainer(media)
	lastMapKey := ""
	if media.Map != nil {
		segment := buildHLSMapSegment(len(manifest.Segments), manifestURL, media.Map)
		lastMapKey = segment.URL + fmt.Sprintf("#%d-%d", segment.Start, segment.End)
		manifest.Segments = append(manifest.Segments, segment)
	}

	for _, mediaSegment := range media.GetAllSegments() {
		if mediaSegment == nil || strings.TrimSpace(mediaSegment.URI) == "" {
			continue
		}

		if mediaSegment.Map != nil {
			mapSegment := buildHLSMapSegment(len(manifest.Segments), manifestURL, mediaSegment.Map)
			mapKey := mapSegment.URL + fmt.Sprintf("#%d-%d", mapSegment.Start, mapSegment.End)
			if mapKey != lastMapKey {
				manifest.Segments = append(manifest.Segments, mapSegment)
				lastMapKey = mapKey
			}
		}

		start, end := parseByteRange(mediaSegment.Limit, mediaSegment.Offset)
		manifest.Segments = append(manifest.Segments, Segment{
			Index:    len(manifest.Segments),
			Start:    start,
			End:      end,
			URL:      resolveVideoURL(manifestURL, mediaSegment.URI),
			Track:    "muxed",
			Duration: mediaSegment.Duration,
		})
	}

	if len(manifest.Segments) == 0 {
		return nil, fmt.Errorf("hls media playlist had no segments")
	}

	return manifest, nil
}

func rejectProtectedHLS(rawManifest string) error {
	lines := strings.Split(rawManifest, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		switch {
		case strings.HasPrefix(trimmed, "#EXT-X-KEY:"), strings.HasPrefix(trimmed, "#EXT-X-SESSION-KEY:"):
			attributes := m3u8.DecodeAttributeList(strings.TrimSpace(strings.SplitN(trimmed, ":", 2)[1]))
			method := strings.ToUpper(strings.TrimSpace(attributes["METHOD"]))
			keyFormat := strings.ToLower(strings.Trim(strings.TrimSpace(attributes["KEYFORMAT"]), `"`))
			if method != "" && method != "NONE" {
				return fmt.Errorf("refusing encrypted hls stream: method %s is unsupported", method)
			}
			if keyFormat != "" && keyFormat != "identity" {
				return fmt.Errorf("refusing drm-protected hls stream: key format %s is unsupported", keyFormat)
			}
		case strings.HasPrefix(trimmed, "#WV"):
			return fmt.Errorf("refusing drm-protected hls stream")
		}
	}

	return nil
}

func detectHLSContainer(media *m3u8.MediaPlaylist) string {
	if media.Map != nil {
		return "mp4"
	}

	for _, mediaSegment := range media.GetAllSegments() {
		if mediaSegment == nil {
			continue
		}
		candidate := strings.ToLower(mediaSegment.URI)
		if strings.Contains(candidate, ".m4s") || strings.Contains(candidate, ".mp4") {
			return "mp4"
		}
		if mediaSegment.Map != nil {
			return "mp4"
		}
	}

	return "ts"
}

func buildHLSMapSegment(index int, manifestURL string, mapping *m3u8.Map) Segment {
	start, end := parseByteRange(mapping.Limit, mapping.Offset)
	return Segment{
		Index: index,
		Start: start,
		End:   end,
		URL:   resolveVideoURL(manifestURL, mapping.URI),
		Track: "muxed",
	}
}