package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ExternalResolverAdapter shells out to a user-configured binary that
// returns a normalized JSON description of the media graph for a given page.
// The adapter caches successful resolutions briefly so a media.resolve
// followed by media.download for the same page does not re-invoke the
// binary.
type ExternalResolverAdapter struct {
	mu      sync.Mutex
	results map[string]externalResolverCacheEntry
}

type externalResolverCacheEntry struct {
	offer     *MediaOffer
	expiresAt time.Time
}

const externalResolverCacheTTL = 30 * time.Second

func NewExternalResolverAdapter() *ExternalResolverAdapter {
	return &ExternalResolverAdapter{results: make(map[string]externalResolverCacheEntry)}
}

func (a *ExternalResolverAdapter) Name() string {
	return "external_resolver"
}

func (a *ExternalResolverAdapter) Match(pageURL string, _ []DetectedEvidence) bool {
	// External resolver is a last-resort adapter; it always matches when
	// enabled because the router only routes here after generic extractors
	// declined. Settings enforcement happens in Resolve().
	return strings.TrimSpace(pageURL) != ""
}

func (a *ExternalResolverAdapter) Resolve(ctx context.Context, input AdapterInput) (*MediaOffer, error) {
	if !input.Settings.ExternalResolverEnabled {
		return nil, fmt.Errorf("%s: external resolver disabled in settings", SiteAdapterFailed)
	}
	binary := strings.TrimSpace(input.Settings.ExternalResolverBinary)
	if binary == "" {
		return nil, fmt.Errorf("%s: external resolver binary path not set", SiteAdapterFailed)
	}

	if offer := a.cachedOffer(input.PageURL); offer != nil {
		return offer, nil
	}

	timeout := time.Duration(input.Settings.ExternalResolverTimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	resolveCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(resolveCtx, binary, "--page-url", input.PageURL, "--format", "json")
	output, err := cmd.Output()
	if err != nil {
		var execErr *exec.Error
		if errors.As(err, &execErr) {
			return nil, fmt.Errorf("%s: resolver binary not executable (%s): %w", SiteAdapterFailed, binary, err)
		}
		return nil, fmt.Errorf("%s: resolver returned error: %w", SiteAdapterFailed, err)
	}

	var payload externalResolverPayload
	if err := json.Unmarshal(output, &payload); err != nil {
		return nil, fmt.Errorf("%s: resolver returned invalid JSON: %w", SiteAdapterFailed, err)
	}

	offer := payload.toMediaOffer()
	offer.PageURL = input.PageURL
	offer.SiteKey = siteKeyFromURL(input.PageURL)
	offer.Strategy = StrategySiteAdapter
	if offer.Debug == nil {
		offer.Debug = make(map[string]string)
	}
	offer.Debug["adapter"] = a.Name()
	offer.Debug["adapter_binary"] = binary
	offer.Debug["adapter_tool_version"] = strings.TrimSpace(payload.ToolVersion)
	if input.Settings.ExternalResolverDebug {
		slog.Info("site_adapter_resolved",
			"adapter", a.Name(),
			"page_url", input.PageURL,
			"site_key", offer.SiteKey,
			"tracks", len(offer.Tracks),
		)
	}

	a.storeOffer(input.PageURL, offer)
	return offer, nil
}

func (a *ExternalResolverAdapter) cachedOffer(pageURL string) *MediaOffer {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry, ok := a.results[pageURL]
	if !ok || time.Now().After(entry.expiresAt) {
		delete(a.results, pageURL)
		return nil
	}
	return entry.offer
}

func (a *ExternalResolverAdapter) storeOffer(pageURL string, offer *MediaOffer) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.results[pageURL] = externalResolverCacheEntry{
		offer:     offer,
		expiresAt: time.Now().Add(externalResolverCacheTTL),
	}
}

type externalResolverPayload struct {
	Title       string                  `json:"title"`
	SourceURL   string                  `json:"source_url"`
	Container   string                  `json:"container"`
	ToolVersion string                  `json:"tool_version"`
	Tracks      []externalResolverTrack `json:"tracks"`
	Variants    []VideoVariant          `json:"variants"`
}

type externalResolverTrack struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	URL         string `json:"url,omitempty"`
	ManifestURL string `json:"manifest_url,omitempty"`
	Codec       string `json:"codec,omitempty"`
	Bitrate     int64  `json:"bitrate,omitempty"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	Container   string `json:"container,omitempty"`
}

func (p externalResolverPayload) toMediaOffer() *MediaOffer {
	tracks := make([]MediaTrack, 0, len(p.Tracks))
	for _, track := range p.Tracks {
		tracks = append(tracks, MediaTrack{
			ID:          track.ID,
			Kind:        track.Kind,
			URL:         track.URL,
			ManifestURL: track.ManifestURL,
			Codec:       track.Codec,
			Bitrate:     track.Bitrate,
			Width:       track.Width,
			Height:      track.Height,
			Container:   track.Container,
		})
	}
	return &MediaOffer{
		Title:     p.Title,
		SourceURL: p.SourceURL,
		Container: p.Container,
		Tracks:    tracks,
		Variants:  p.Variants,
	}
}
