package main

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	manifestTypeHLS     = "HLS"
	manifestTypeDASH    = "DASH"
	manifestTypeYouTube = "YOUTUBE"
)

var isoDurationPattern = regexp.MustCompile(`^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$`)

type VideoDownloadRequest struct {
	URL               string            `json:"url"`
	Filename          string            `json:"filename"`
	ManifestType      string            `json:"manifestType,omitempty"`
	SelectedVariantID string            `json:"selectedVariantId,omitempty"`
	Segments          int               `json:"segments,omitempty"`
	Headers           map[string]string `json:"headers,omitempty"`
	Cookies           []RequestCookie   `json:"cookies,omitempty"`
	Schedule          *DownloadSchedule `json:"schedule,omitempty"`
}

type VideoManifest struct {
	ManifestType      string
	SelectedVariantID string
	Container         string
	Title             string
	TotalBytes        int64
	Variants          []VideoVariant
	Segments          []Segment
}

func resolveVideoManifest(ctx context.Context, req VideoDownloadRequest) (*VideoManifest, error) {
	if strings.EqualFold(strings.TrimSpace(req.ManifestType), manifestTypeYouTube) || isYouTubeURL(req.URL) {
		return resolveYouTubeManifest(ctx, req)
	}

	rawManifest, finalURL, err := fetchManifest(ctx, req.URL, req.Headers, req.Cookies)
	if err != nil {
		return nil, err
	}

	switch detectManifestType(req.ManifestType, finalURL, rawManifest) {
	case manifestTypeHLS:
		return parseHLSManifest(ctx, finalURL, rawManifest, req)
	case manifestTypeDASH:
		return parseDASHManifest(finalURL, rawManifest, req)
	default:
		return nil, fmt.Errorf("unsupported manifest type for %s", req.URL)
	}
}

func detectManifestType(hint string, manifestURL string, rawManifest string) string {
	normalizedHint := strings.ToUpper(strings.TrimSpace(hint))
	if normalizedHint == manifestTypeHLS || normalizedHint == manifestTypeDASH {
		return normalizedHint
	}

	lowerURL := strings.ToLower(manifestURL)
	switch {
	case strings.Contains(lowerURL, ".m3u8"):
		return manifestTypeHLS
	case strings.Contains(lowerURL, ".mpd"):
		return manifestTypeDASH
	case strings.Contains(rawManifest, "#EXTM3U"):
		return manifestTypeHLS
	case strings.Contains(rawManifest, "<MPD"):
		return manifestTypeDASH
	default:
		return ""
	}
}

func fetchManifest(ctx context.Context, manifestURL string, headers map[string]string, cookies []RequestCookie) (string, string, error) {
	resp, finalURL, err := doRequestWithRedirects(ctx, http.MethodGet, manifestURL, headers, cookies, nil)
	if err != nil {
		return "", finalURL, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", finalURL, fmt.Errorf("manifest request returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", finalURL, err
	}

	return string(body), finalURL, nil
}

func resolveVideoURL(baseURL string, ref string) string {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return baseURL
	}

	base, err := url.Parse(baseURL)
	if err != nil {
		return trimmed
	}
	resolved, err := url.Parse(trimmed)
	if err != nil {
		return trimmed
	}

	return base.ResolveReference(resolved).String()
}

func resolveNestedVideoURL(baseURL string, refs ...string) string {
	current := baseURL
	for _, ref := range refs {
		if strings.TrimSpace(ref) == "" {
			continue
		}
		current = resolveVideoURL(current, ref)
	}
	return current
}

func nextSegmentRange(start int64, end int64) (int64, int64) {
	if start < 0 {
		start = 0
	}
	if end >= start {
		return start, end
	}
	return 0, -1
}

func parseByteRange(limit int64, offset int64) (int64, int64) {
	if limit <= 0 {
		return 0, -1
	}

	if offset < 0 {
		offset = 0
	}
	return offset, offset + limit - 1
}

func parseHyphenRange(value string) (int64, int64, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, -1, nil
	}

	parts := strings.Split(trimmed, "-")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid range %q", value)
	}

	start, err := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
	if err != nil {
		return 0, 0, err
	}
	end, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil {
		return 0, 0, err
	}
	return start, end, nil
}

func templateTokenValue(value int64) string {
	return strconv.FormatInt(value, 10)
}

func fillDashTemplate(template string, variant VideoVariant, number int64, timeValue int64) string {
	result := strings.ReplaceAll(template, "$$", "__DOLLAR__")
	result = strings.ReplaceAll(result, "$RepresentationID$", variant.ID)
	result = strings.ReplaceAll(result, "$Bandwidth$", templateTokenValue(variant.Bandwidth))
	result = strings.ReplaceAll(result, "$Number$", templateTokenValue(number))
	result = strings.ReplaceAll(result, "$Time$", templateTokenValue(timeValue))
	return strings.ReplaceAll(result, "__DOLLAR__", "$")
}

func parseISODuration(value string) (time.Duration, error) {
	matches := isoDurationPattern.FindStringSubmatch(strings.TrimSpace(value))
	if matches == nil {
		return 0, fmt.Errorf("unsupported duration %q", value)
	}

	parts := []struct {
		value string
		scale time.Duration
	}{
		{matches[1], 24 * time.Hour},
		{matches[2], time.Hour},
		{matches[3], time.Minute},
	}

	var total time.Duration
	for _, part := range parts {
		if part.value == "" {
			continue
		}
		parsed, err := strconv.ParseInt(part.value, 10, 64)
		if err != nil {
			return 0, err
		}
		total += time.Duration(parsed) * part.scale
	}

	if matches[4] != "" {
		seconds, err := strconv.ParseFloat(matches[4], 64)
		if err != nil {
			return 0, err
		}
		total += time.Duration(seconds * float64(time.Second))
	}

	return total, nil
}

func ceilDurationSegments(total time.Duration, perSegment float64) int {
	if total <= 0 || perSegment <= 0 {
		return 0
	}
	return int(math.Ceil(total.Seconds() / perSegment))
}

func variantNameFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return strings.TrimSpace(rawURL)
	}
	name := path.Base(parsed.Path)
	if name == "." || name == "/" {
		return strings.TrimSpace(rawURL)
	}
	return name
}
