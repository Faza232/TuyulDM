package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
)

type ExtractionStrategy string

const (
	StrategyDirectFile           ExtractionStrategy = "direct_file"
	StrategyProgressiveStream    ExtractionStrategy = "progressive_stream"
	StrategyHLSManifest          ExtractionStrategy = "hls_manifest"
	StrategyDASHManifest         ExtractionStrategy = "dash_manifest"
	StrategyMSEObserved          ExtractionStrategy = "mse_observed_manifest"
	StrategyPageMetadata         ExtractionStrategy = "page_metadata"
	StrategySiteAdapter          ExtractionStrategy = "site_adapter"
	StrategyUnsupportedProtected ExtractionStrategy = "unsupported_protected"
)

type MediaTrack struct {
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

type DetectedEvidence struct {
	CandidateURL         string `json:"candidateUrl,omitempty"`
	ContentType          string `json:"contentType,omitempty"`
	ManifestType         string `json:"manifestType,omitempty"`
	MimeFromMSE          string `json:"mimeFromMSE,omitempty"`
	SawBlobPlayback      bool   `json:"sawBlobPlayback,omitempty"`
	SawRangeRequests     bool   `json:"sawRangeRequests,omitempty"`
	HadAudioVideoTraffic bool   `json:"hadAudioVideoTraffic,omitempty"`
	TopOrigin            string `json:"topOrigin,omitempty"`
}

type MediaOffer struct {
	ID              string             `json:"id"`
	PageURL         string             `json:"page_url,omitempty"`
	SourceURL       string             `json:"source_url"`
	SiteKey         string             `json:"site_key,omitempty"`
	Title           string             `json:"title,omitempty"`
	Strategy        ExtractionStrategy `json:"strategy"`
	Container       string             `json:"container,omitempty"`
	MimeType        string             `json:"mime_type,omitempty"`
	NeedsPlayback   bool               `json:"needs_playback,omitempty"`
	Protected       bool               `json:"protected,omitempty"`
	ProtectedReason string             `json:"protected_reason,omitempty"`
	ExpiresAt       time.Time          `json:"expires_at,omitempty"`
	Tracks          []MediaTrack       `json:"tracks,omitempty"`
	Variants        []VideoVariant     `json:"variants,omitempty"`
	Headers         map[string]string  `json:"headers,omitempty"`
	Cookies         []RequestCookie    `json:"cookies,omitempty"`
	Debug           map[string]string  `json:"debug,omitempty"`
}

type MediaResolveCandidate struct {
	URL              string             `json:"url"`
	MimeType         string             `json:"mimeType,omitempty"`
	ManifestType     string             `json:"manifestType,omitempty"`
	Container        string             `json:"container,omitempty"`
	Kind             string             `json:"kind,omitempty"`
	Title            string             `json:"title,omitempty"`
	Filename         string             `json:"filename,omitempty"`
	Protected        bool               `json:"protected,omitempty"`
	ProtectedReason  string             `json:"protectedReason,omitempty"`
	SelectedVariant  string             `json:"selectedVariantId,omitempty"`
	Variants         []VideoVariant     `json:"variants,omitempty"`
	Evidence         *DetectedEvidence  `json:"evidence,omitempty"`
}

type MediaResolveRequest struct {
	PageURL           string                `json:"pageUrl,omitempty"`
	Candidate         MediaResolveCandidate `json:"candidate"`
	SelectedVariantID string                `json:"selectedVariantId,omitempty"`
	Headers           map[string]string     `json:"headers,omitempty"`
	Cookies           []RequestCookie       `json:"cookies,omitempty"`
}

type MediaDownloadRequest struct {
	OfferID           string            `json:"offerId"`
	SelectedVariantID string            `json:"selectedVariantId,omitempty"`
	Filename          string            `json:"filename,omitempty"`
	Schedule          *DownloadSchedule `json:"schedule,omitempty"`
}

var (
	errOfferNotFound = errors.New("media offer not found")
	errOfferExpired  = errors.New("media offer expired")
)

// ResolverContext bundles the runtime services ResolveMediaOffer needs to
// consult adapters and settings. It is set once at host startup so the IPC
// handlers can call the free-function ResolveMediaOffer without threading
// the engine through every call site.
type ResolverContext struct {
	Adapters *SiteAdapterRegistry
	Settings func() HostSettings
}

var activeResolverContext *ResolverContext

func SetActiveResolverContext(rc *ResolverContext) {
	activeResolverContext = rc
}

const offerCacheTTL = 10 * time.Minute

type offerCacheEntry struct {
	offer     *MediaOffer
	createdAt time.Time
}

type MediaOfferCache struct {
	mu      sync.Mutex
	entries map[string]offerCacheEntry
}

func newMediaOfferCache() *MediaOfferCache {
	return &MediaOfferCache{entries: make(map[string]offerCacheEntry)}
}

func (c *MediaOfferCache) Put(offer *MediaOffer) {
	if offer == nil || strings.TrimSpace(offer.ID) == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gcLocked(time.Now())
	c.entries[offer.ID] = offerCacheEntry{offer: offer, createdAt: time.Now()}
}

func (c *MediaOfferCache) Get(id string) (*MediaOffer, error) {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return nil, errOfferNotFound
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[trimmed]
	if !ok {
		return nil, errOfferNotFound
	}
	if time.Since(entry.createdAt) > offerCacheTTL {
		delete(c.entries, trimmed)
		return nil, errOfferExpired
	}
	return entry.offer, nil
}

func (c *MediaOfferCache) gcLocked(now time.Time) {
	for id, entry := range c.entries {
		if now.Sub(entry.createdAt) > offerCacheTTL {
			delete(c.entries, id)
		}
	}
}

func newOfferID() string {
	return fmt.Sprintf("offer-%d", time.Now().UnixNano())
}

func siteKeyFromURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return ""
	}
	host := strings.ToLower(parsed.Host)
	host = strings.TrimPrefix(host, "www.")
	return host
}

// ResolveMediaOffer turns a detected candidate into a normalized MediaOffer.
// Phase P implementation: classify by candidate hints + manifest probe, but
// do not fan out into adapters or page metadata yet (Phase Q/R/S add that).
func ResolveMediaOffer(ctx context.Context, req MediaResolveRequest) (*MediaOffer, error) {
	candidate := req.Candidate
	if strings.TrimSpace(candidate.URL) == "" {
		return nil, fmt.Errorf("candidate url is required")
	}

	headers := sanitizeRequestHeaders(req.Headers)
	cookies := sanitizeRequestCookies(req.Cookies)

	offer := &MediaOffer{
		ID:        newOfferID(),
		PageURL:   strings.TrimSpace(req.PageURL),
		SourceURL: candidate.URL,
		SiteKey:   siteKeyFromURL(req.PageURL),
		Title:     strings.TrimSpace(candidate.Title),
		Container: strings.TrimSpace(candidate.Container),
		MimeType:  strings.TrimSpace(candidate.MimeType),
		Headers:   headers,
		Cookies:   cookies,
		Debug:     make(map[string]string),
	}

	if offer.SiteKey == "" {
		offer.SiteKey = siteKeyFromURL(candidate.URL)
	}

	decision := RouteExtractionStrategy(candidate, candidate.Evidence)
	logRouteDecision(offer.SiteKey, candidate, decision)
	offer.Strategy = decision.Strategy
	offer.Debug["route_confidence"] = fmt.Sprintf("%d", decision.Confidence)
	offer.Debug["route_reason"] = decision.Reason

	if adapterOffer, ok := tryAdapter(ctx, req, candidate); ok {
		offer.Strategy = StrategySiteAdapter
		offer.SourceURL = pickFirstNonEmpty(adapterOffer.SourceURL, offer.SourceURL)
		offer.Title = pickFirstNonEmpty(adapterOffer.Title, offer.Title)
		offer.Container = pickFirstNonEmpty(adapterOffer.Container, offer.Container)
		offer.Tracks = adapterOffer.Tracks
		offer.Variants = adapterOffer.Variants
		mergeOfferDebug(offer, adapterOffer)
		return offer, nil
	}

	if decision.Strategy == StrategyUnsupportedProtected {
		offer.Protected = true
		offer.ProtectedReason = strings.TrimSpace(candidate.ProtectedReason)
		if offer.ProtectedReason == "" {
			offer.ProtectedReason = "drm_detected"
		}
		return offer, nil
	}

	if decision.Strategy == StrategyPageMetadata || decision.Strategy == StrategySiteAdapter {
		offer.Debug["raw_candidate_url"] = candidate.URL
		offer.Debug["raw_candidate_kind"] = candidate.Kind
		offer.Debug["raw_candidate_mime"] = candidate.MimeType
	}

	if err := populateOfferByStrategy(ctx, offer, candidate, MediaResolveRequest{
		PageURL:           req.PageURL,
		Candidate:         candidate,
		SelectedVariantID: req.SelectedVariantID,
		Headers:           headers,
		Cookies:           cookies,
	}); err != nil {
		return nil, err
	}

	if candidate.Evidence != nil {
		offer.Debug["evidence_top_origin"] = candidate.Evidence.TopOrigin
		offer.Debug["evidence_content_type"] = candidate.Evidence.ContentType
	}

	return offer, nil
}

func populateOfferByStrategy(ctx context.Context, offer *MediaOffer, candidate MediaResolveCandidate, req MediaResolveRequest) error {
	switch offer.Strategy {
	case StrategyHLSManifest, StrategyMSEObserved:
		manifestOffer, err := extractHLSOffer(ctx, candidate, req)
		if err != nil {
			if manifestOffer != nil {
				mergeOfferDebug(offer, manifestOffer)
			}
			return err
		}
		offer.Variants = manifestOffer.Variants
		offer.Container = manifestOffer.Container
		offer.Tracks = manifestOffer.Tracks
		mergeOfferDebug(offer, manifestOffer)
		offer.Debug["track_count"] = fmt.Sprintf("%d", len(offer.Tracks))
	case StrategyDASHManifest:
		manifestOffer, err := extractDASHOffer(ctx, candidate, req)
		if err != nil {
			if manifestOffer != nil {
				mergeOfferDebug(offer, manifestOffer)
			}
			return err
		}
		offer.Variants = manifestOffer.Variants
		offer.Container = manifestOffer.Container
		offer.Tracks = manifestOffer.Tracks
		mergeOfferDebug(offer, manifestOffer)
		offer.Debug["track_count"] = fmt.Sprintf("%d", len(offer.Tracks))
	case StrategyProgressiveStream:
		probed, err := extractProgressiveOffer(ctx, candidate, req.Headers, req.Cookies)
		if err != nil {
			// downgrade to direct if range probe failed but candidate still looks fetchable
			probedDirect, directErr := extractDirectOffer(ctx, candidate, req.Headers, req.Cookies)
			if directErr != nil {
				return err
			}
			offer.Strategy = StrategyDirectFile
			offer.Debug["downgrade_reason"] = err.Error()
			applyProbedOffer(offer, probedDirect)
			return nil
		}
		applyProbedOffer(offer, probed)
	case StrategyDirectFile:
		probed, err := extractDirectOffer(ctx, candidate, req.Headers, req.Cookies)
		if err != nil {
			return err
		}
		if probed.acceptRanges {
			offer.Strategy = StrategyProgressiveStream
		}
		applyProbedOffer(offer, probed)
	case StrategyPageMetadata:
		pageOffer, err := extractPageMetadataOffer(ctx, candidate)
		if err != nil {
			return err
		}
		offer.SourceURL = pickFirstNonEmpty(pageOffer.SourceURL, offer.SourceURL)
		offer.Title = pickFirstNonEmpty(pageOffer.Title, offer.Title)
		offer.Container = pickFirstNonEmpty(pageOffer.Container, offer.Container)
		offer.Tracks = pageOffer.Tracks
		mergeOfferDebug(offer, pageOffer)
	default:
		offer.Tracks = []MediaTrack{{
			ID:        "main",
			Kind:      "muxed",
			URL:       candidate.URL,
			Container: offer.Container,
		}}
	}
	return nil
}

func applyProbedOffer(offer *MediaOffer, probed probedOffer) {
	if probed.offer == nil {
		return
	}
	offer.SourceURL = pickFirstNonEmpty(probed.offer.SourceURL, offer.SourceURL)
	offer.Container = pickFirstNonEmpty(probed.offer.Container, offer.Container)
	offer.MimeType = pickFirstNonEmpty(probed.offer.MimeType, offer.MimeType)
	offer.Tracks = probed.offer.Tracks
	if probed.acceptRanges {
		offer.Debug["accept_ranges"] = "true"
	}
	if probed.totalSize > 0 {
		offer.Debug["total_size"] = fmt.Sprintf("%d", probed.totalSize)
	}
}

func tryAdapter(ctx context.Context, req MediaResolveRequest, candidate MediaResolveCandidate) (*MediaOffer, bool) {
	rc := activeResolverContext
	if rc == nil || rc.Adapters == nil || rc.Settings == nil {
		return nil, false
	}
	pageURL := strings.TrimSpace(req.PageURL)
	if pageURL == "" {
		return nil, false
	}
	settings := rc.Settings()
	if !settings.ExternalResolverEnabled {
		return nil, false
	}
	evidence := []DetectedEvidence{}
	if candidate.Evidence != nil {
		evidence = append(evidence, *candidate.Evidence)
	}
	adapter := rc.Adapters.FindMatch(pageURL, evidence)
	if adapter == nil {
		return nil, false
	}
	offer, err := adapter.Resolve(ctx, AdapterInput{
		PageURL:    pageURL,
		Candidates: []MediaResolveCandidate{candidate},
		Headers:    req.Headers,
		Cookies:    req.Cookies,
		Settings:   settings,
	})
	if err != nil {
		// Adapter declined or failed; the caller decides whether to fall through.
		return nil, false
	}
	return offer, offer != nil
}

func mergeOfferDebug(dst *MediaOffer, src *MediaOffer) {
	if dst == nil || src == nil {
		return
	}
	if dst.Debug == nil {
		dst.Debug = make(map[string]string)
	}
	for key, value := range src.Debug {
		dst.Debug[key] = value
	}
}

func tracksFromManifest(manifest *VideoManifest) []MediaTrack {
	if manifest == nil {
		return nil
	}
	kinds := map[string]bool{}
	for _, segment := range manifest.Segments {
		track := segment.Track
		if track == "" {
			track = "muxed"
		}
		kinds[track] = true
	}
	if len(kinds) == 0 {
		return []MediaTrack{{ID: "muxed", Kind: "muxed", Container: manifest.Container}}
	}
	ordered := []string{"video", "audio", "muxed"}
	tracks := make([]MediaTrack, 0, len(kinds))
	for _, kind := range ordered {
		if kinds[kind] {
			tracks = append(tracks, MediaTrack{ID: kind, Kind: kind, Container: manifest.Container})
			delete(kinds, kind)
		}
	}
	for kind := range kinds {
		tracks = append(tracks, MediaTrack{ID: kind, Kind: kind, Container: manifest.Container})
	}
	return tracks
}

func pickFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// videoDownloadRequestFromOffer turns a resolved MediaOffer into the legacy
// VideoDownloadRequest contract used by Engine.AddVideo. Compat shim for Phase P.
func videoDownloadRequestFromOffer(offer *MediaOffer, selectedVariantID string, filename string, schedule *DownloadSchedule) VideoDownloadRequest {
	manifestType := ""
	switch offer.Strategy {
	case StrategyHLSManifest, StrategyMSEObserved:
		manifestType = manifestTypeHLS
	case StrategyDASHManifest:
		manifestType = manifestTypeDASH
	}
	variant := strings.TrimSpace(selectedVariantID)
	if variant == "" {
		variant = offer.Debug["selected_variant_id"]
	}
	return VideoDownloadRequest{
		URL:               offer.SourceURL,
		Filename:          filename,
		ManifestType:      manifestType,
		SelectedVariantID: variant,
		Headers:           offer.Headers,
		Cookies:           offer.Cookies,
		Schedule:          schedule,
	}
}

func offerTrackCount(offer *MediaOffer) int {
	if offer == nil {
		return 0
	}
	if len(offer.Tracks) > 0 {
		return len(offer.Tracks)
	}
	return len(offer.Variants)
}

func compactOfferDebug(offer *MediaOffer) map[string]string {
	if offer == nil || len(offer.Debug) == 0 {
		return nil
	}
	clone := make(map[string]string, len(offer.Debug))
	for key, value := range offer.Debug {
		clone[key] = value
	}
	return clone
}
