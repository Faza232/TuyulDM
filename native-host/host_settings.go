package main

import "strings"

const (
	defaultMaxConcurrentDownloads = 3
	maxConcurrentDownloadsLimit   = 32
	defaultMaxSegmentsPerDownload = 32
	maxSegmentsPerDownloadLimit   = 32
	defaultSegmentStallTimeoutSec = 30
	minSegmentStallTimeoutSec     = 5
	maxSegmentStallTimeoutSec     = 600
)

type HostSettings struct {
	MaxConcurrentDownloads            int    `json:"maxConcurrentDownloads"`
	MaxSegmentsPerDownload            int    `json:"maxSegmentsPerDownload"`
	VerifyIntegrity                   *bool  `json:"verifyIntegrity,omitempty"`
	GlobalThrottleBytesPerSecond      int64  `json:"globalThrottleBytesPerSecond"`
	PerDownloadThrottleBytesPerSecond int64  `json:"perDownloadThrottleBytesPerSecond"`
	SegmentStallTimeoutSec            int    `json:"segmentStallTimeoutSec"`
	DownloadDir                       string `json:"downloadDir"`
	LogLevel                          string `json:"logLevel"`
	ExternalResolverEnabled           bool   `json:"externalResolverEnabled,omitempty"`
	ExternalResolverBinary            string `json:"externalResolverBinary,omitempty"`
	ExternalResolverTimeoutMs         int    `json:"externalResolverTimeoutMs,omitempty"`
	ExternalResolverDebug             bool   `json:"externalResolverDebug,omitempty"`
}

type HostSettingsUpdate struct {
	MaxConcurrentDownloads            *int    `json:"maxConcurrentDownloads,omitempty"`
	MaxSegmentsPerDownload            *int    `json:"maxSegmentsPerDownload,omitempty"`
	VerifyIntegrity                   *bool   `json:"verifyIntegrity,omitempty"`
	GlobalThrottleBytesPerSecond      *int64  `json:"globalThrottleBytesPerSecond,omitempty"`
	PerDownloadThrottleBytesPerSecond *int64  `json:"perDownloadThrottleBytesPerSecond,omitempty"`
	SegmentStallTimeoutSec            *int    `json:"segmentStallTimeoutSec,omitempty"`
	DownloadDir                       *string `json:"downloadDir,omitempty"`
	LogLevel                          *string `json:"logLevel,omitempty"`
	ExternalResolverEnabled           *bool   `json:"externalResolverEnabled,omitempty"`
	ExternalResolverBinary            *string `json:"externalResolverBinary,omitempty"`
	ExternalResolverTimeoutMs         *int    `json:"externalResolverTimeoutMs,omitempty"`
	ExternalResolverDebug             *bool   `json:"externalResolverDebug,omitempty"`
}

func defaultHostSettings() HostSettings {
	return HostSettings{
		MaxConcurrentDownloads: defaultMaxConcurrentDownloads,
		MaxSegmentsPerDownload: defaultMaxSegmentsPerDownload,
		VerifyIntegrity:        boolPtr(true),
		SegmentStallTimeoutSec: defaultSegmentStallTimeoutSec,
		LogLevel:               defaultHostLogLevel,
	}
}

func normalizeHostSettings(settings HostSettings) HostSettings {
	if settings.VerifyIntegrity == nil {
		settings.VerifyIntegrity = boolPtr(true)
	}
	if settings.MaxConcurrentDownloads <= 0 {
		settings.MaxConcurrentDownloads = defaultMaxConcurrentDownloads
	}
	if settings.MaxConcurrentDownloads > maxConcurrentDownloadsLimit {
		settings.MaxConcurrentDownloads = maxConcurrentDownloadsLimit
	}
	if settings.MaxSegmentsPerDownload <= 0 {
		settings.MaxSegmentsPerDownload = defaultMaxSegmentsPerDownload
	}
	if settings.MaxSegmentsPerDownload > maxSegmentsPerDownloadLimit {
		settings.MaxSegmentsPerDownload = maxSegmentsPerDownloadLimit
	}
	if settings.GlobalThrottleBytesPerSecond < 0 {
		settings.GlobalThrottleBytesPerSecond = 0
	}
	if settings.PerDownloadThrottleBytesPerSecond < 0 {
		settings.PerDownloadThrottleBytesPerSecond = 0
	}
	if settings.SegmentStallTimeoutSec <= 0 {
		settings.SegmentStallTimeoutSec = defaultSegmentStallTimeoutSec
	}
	if settings.SegmentStallTimeoutSec < minSegmentStallTimeoutSec {
		settings.SegmentStallTimeoutSec = minSegmentStallTimeoutSec
	}
	if settings.SegmentStallTimeoutSec > maxSegmentStallTimeoutSec {
		settings.SegmentStallTimeoutSec = maxSegmentStallTimeoutSec
	}
	settings.DownloadDir = strings.TrimSpace(settings.DownloadDir)
	settings.LogLevel = normalizeHostLogLevel(settings.LogLevel)
	return settings
}

func applyHostSettingsUpdate(current HostSettings, update HostSettingsUpdate) HostSettings {
	if update.MaxConcurrentDownloads != nil {
		current.MaxConcurrentDownloads = *update.MaxConcurrentDownloads
	}
	if update.MaxSegmentsPerDownload != nil {
		current.MaxSegmentsPerDownload = *update.MaxSegmentsPerDownload
	}
	if update.VerifyIntegrity != nil {
		current.VerifyIntegrity = boolPtr(*update.VerifyIntegrity)
	}
	if update.GlobalThrottleBytesPerSecond != nil {
		current.GlobalThrottleBytesPerSecond = *update.GlobalThrottleBytesPerSecond
	}
	if update.PerDownloadThrottleBytesPerSecond != nil {
		current.PerDownloadThrottleBytesPerSecond = *update.PerDownloadThrottleBytesPerSecond
	}
	if update.SegmentStallTimeoutSec != nil {
		current.SegmentStallTimeoutSec = *update.SegmentStallTimeoutSec
	}
	if update.DownloadDir != nil {
		current.DownloadDir = *update.DownloadDir
	}
	if update.LogLevel != nil {
		current.LogLevel = *update.LogLevel
	}
	if update.ExternalResolverEnabled != nil {
		current.ExternalResolverEnabled = *update.ExternalResolverEnabled
	}
	if update.ExternalResolverBinary != nil {
		current.ExternalResolverBinary = *update.ExternalResolverBinary
	}
	if update.ExternalResolverTimeoutMs != nil {
		current.ExternalResolverTimeoutMs = *update.ExternalResolverTimeoutMs
	}
	if update.ExternalResolverDebug != nil {
		current.ExternalResolverDebug = *update.ExternalResolverDebug
	}
	return normalizeHostSettings(current)
}

func validateHostSettingsUpdate(settings HostSettings) (HostSettings, error) {
	normalized := normalizeHostSettings(settings)
	downloadDir, err := validateDownloadDir(normalized.DownloadDir, false)
	if err != nil {
		return HostSettings{}, err
	}
	normalized.DownloadDir = downloadDir
	return normalized, nil
}

func hydrateHostSettings(settings HostSettings) (HostSettings, bool, error) {
	normalized := normalizeHostSettings(settings)
	originalDir := normalized.DownloadDir
	downloadDir := originalDir
	changed := false

	if downloadDir == "" {
		migratedDir, ok, err := migratedLegacyDownloadDir()
		if err != nil {
			return HostSettings{}, false, err
		}
		if ok {
			downloadDir = migratedDir
			changed = true
		} else {
			defaultDir, err := defaultDownloadsDir()
			if err != nil {
				return HostSettings{}, false, err
			}
			downloadDir = defaultDir
			changed = true
		}
	}

	legacyDir, err := legacyDownloadsDirPath()
	if err != nil {
		return HostSettings{}, false, err
	}
	allowInsideDataDir := sameCleanPath(downloadDir, legacyDir)
	validatedDir, err := validateDownloadDir(downloadDir, allowInsideDataDir)
	if err != nil {
		return HostSettings{}, false, err
	}
	if validatedDir != originalDir {
		changed = true
	}
	normalized.DownloadDir = validatedDir
	return normalized, changed, nil
}

func (s HostSettings) VerifyIntegrityEnabled() bool {
	return s.VerifyIntegrity == nil || *s.VerifyIntegrity
}

func boolPtr(value bool) *bool {
	return &value
}
