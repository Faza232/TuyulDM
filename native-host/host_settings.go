package main

import "strings"

const (
	defaultMaxConcurrentDownloads = 3
	maxConcurrentDownloadsLimit   = 32
)

type HostSettings struct {
	MaxConcurrentDownloads            int   `json:"maxConcurrentDownloads"`
	GlobalThrottleBytesPerSecond      int64 `json:"globalThrottleBytesPerSecond"`
	PerDownloadThrottleBytesPerSecond int64 `json:"perDownloadThrottleBytesPerSecond"`
	DownloadDir                       string `json:"downloadDir"`
	LogLevel                          string `json:"logLevel"`
}

type HostSettingsUpdate struct {
	MaxConcurrentDownloads            *int   `json:"maxConcurrentDownloads,omitempty"`
	GlobalThrottleBytesPerSecond      *int64 `json:"globalThrottleBytesPerSecond,omitempty"`
	PerDownloadThrottleBytesPerSecond *int64 `json:"perDownloadThrottleBytesPerSecond,omitempty"`
	DownloadDir                       *string `json:"downloadDir,omitempty"`
	LogLevel                          *string `json:"logLevel,omitempty"`
}

func defaultHostSettings() HostSettings {
	return HostSettings{
		MaxConcurrentDownloads: defaultMaxConcurrentDownloads,
		LogLevel:               defaultHostLogLevel,
	}
}

func normalizeHostSettings(settings HostSettings) HostSettings {
	if settings.MaxConcurrentDownloads <= 0 {
		settings.MaxConcurrentDownloads = defaultMaxConcurrentDownloads
	}
	if settings.MaxConcurrentDownloads > maxConcurrentDownloadsLimit {
		settings.MaxConcurrentDownloads = maxConcurrentDownloadsLimit
	}
	if settings.GlobalThrottleBytesPerSecond < 0 {
		settings.GlobalThrottleBytesPerSecond = 0
	}
	if settings.PerDownloadThrottleBytesPerSecond < 0 {
		settings.PerDownloadThrottleBytesPerSecond = 0
	}
	settings.DownloadDir = strings.TrimSpace(settings.DownloadDir)
	settings.LogLevel = normalizeHostLogLevel(settings.LogLevel)
	return settings
}

func applyHostSettingsUpdate(current HostSettings, update HostSettingsUpdate) HostSettings {
	if update.MaxConcurrentDownloads != nil {
		current.MaxConcurrentDownloads = *update.MaxConcurrentDownloads
	}
	if update.GlobalThrottleBytesPerSecond != nil {
		current.GlobalThrottleBytesPerSecond = *update.GlobalThrottleBytesPerSecond
	}
	if update.PerDownloadThrottleBytesPerSecond != nil {
		current.PerDownloadThrottleBytesPerSecond = *update.PerDownloadThrottleBytesPerSecond
	}
	if update.DownloadDir != nil {
		current.DownloadDir = *update.DownloadDir
	}
	if update.LogLevel != nil {
		current.LogLevel = *update.LogLevel
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
