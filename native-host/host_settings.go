package main

const (
	defaultMaxConcurrentDownloads = 3
	maxConcurrentDownloadsLimit   = 32
)

type HostSettings struct {
	MaxConcurrentDownloads            int   `json:"maxConcurrentDownloads"`
	GlobalThrottleBytesPerSecond      int64 `json:"globalThrottleBytesPerSecond"`
	PerDownloadThrottleBytesPerSecond int64 `json:"perDownloadThrottleBytesPerSecond"`
	LogLevel                          string `json:"logLevel"`
}

type HostSettingsUpdate struct {
	MaxConcurrentDownloads            *int   `json:"maxConcurrentDownloads,omitempty"`
	GlobalThrottleBytesPerSecond      *int64 `json:"globalThrottleBytesPerSecond,omitempty"`
	PerDownloadThrottleBytesPerSecond *int64 `json:"perDownloadThrottleBytesPerSecond,omitempty"`
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
	if update.LogLevel != nil {
		current.LogLevel = *update.LogLevel
	}
	return normalizeHostSettings(current)
}
