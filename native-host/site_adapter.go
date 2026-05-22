package main

import (
	"context"
	"strings"
	"sync"
)

// SiteAdapter resolves a page URL into a canonical MediaOffer. Adapters own
// site-specific media graph resolution; core TuyulDM owns detection,
// routing, transport, resume, and mux.
type SiteAdapter interface {
	Name() string
	Match(pageURL string, evidence []DetectedEvidence) bool
	Resolve(ctx context.Context, input AdapterInput) (*MediaOffer, error)
}

type AdapterInput struct {
	PageURL      string
	TopFrameURL  string
	Candidates   []MediaResolveCandidate
	Headers      map[string]string
	Cookies      []RequestCookie
	HTMLSnapshot string
	Settings     HostSettings
}

type SiteAdapterRegistry struct {
	mu       sync.RWMutex
	adapters []SiteAdapter
}

func NewSiteAdapterRegistry() *SiteAdapterRegistry {
	return &SiteAdapterRegistry{}
}

func (r *SiteAdapterRegistry) Register(adapter SiteAdapter) {
	if adapter == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters = append(r.adapters, adapter)
}

func (r *SiteAdapterRegistry) FindMatch(pageURL string, evidence []DetectedEvidence) SiteAdapter {
	if strings.TrimSpace(pageURL) == "" {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, adapter := range r.adapters {
		if adapter.Match(pageURL, evidence) {
			return adapter
		}
	}
	return nil
}

// SiteAdapterFailed is the canonical refusal reason exposed when an adapter
// matches a site but cannot produce a stable MediaOffer.
const SiteAdapterFailed = "site_adapter_failed"
