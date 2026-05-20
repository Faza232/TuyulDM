package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// DataDir returns the per-user data directory for TuyulDM, creating it if needed.
//
//   Linux:   $XDG_DATA_HOME/tuyuldm  (fallback ~/.local/share/tuyuldm)
//   macOS:   ~/Library/Application Support/TuyulDM
//   Windows: %LOCALAPPDATA%\TuyulDM  (fallback %APPDATA%\TuyulDM)
func DataDir() (string, error) {
	dir, err := resolveDataDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create data dir %q: %w", dir, err)
	}
	return dir, nil
}

func resolveDataDir() (string, error) {
	switch runtime.GOOS {
	case "linux":
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "tuyuldm"), nil
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".local", "share", "tuyuldm"), nil

	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "TuyulDM"), nil

	case "windows":
		if base := os.Getenv("LOCALAPPDATA"); base != "" {
			return filepath.Join(base, "TuyulDM"), nil
		}
		if base := os.Getenv("APPDATA"); base != "" {
			return filepath.Join(base, "TuyulDM"), nil
		}
		return "", fmt.Errorf("neither LOCALAPPDATA nor APPDATA is set")

	default:
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".tuyuldm"), nil
	}
}

// DownloadsDir returns the resolved default download directory.
func DownloadsDir() (string, error) {
	return ResolveDownloadDir(defaultHostSettings())
}

func ResolveDownloadDir(settings HostSettings) (string, error) {
	downloadDir := strings.TrimSpace(normalizeHostSettings(settings).DownloadDir)
	if downloadDir == "" {
		var err error
		downloadDir, err = defaultDownloadsDir()
		if err != nil {
			return "", err
		}
	}
	return ensureDownloadDir(downloadDir)
}

func defaultDownloadsDir() (string, error) {
	switch runtime.GOOS {
	case "linux":
		return resolveLinuxDownloadsDir()
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Downloads"), nil
	case "windows":
		return resolveWindowsDownloadsDir()
	default:
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Downloads"), nil
	}
}

func resolveLinuxDownloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	if envDir := strings.TrimSpace(os.Getenv("XDG_DOWNLOAD_DIR")); envDir != "" {
		return expandDownloadDirValue(envDir, home), nil
	}

	configPath := filepath.Join(home, ".config", "user-dirs.dirs")
	if configHome := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); configHome != "" {
		configPath = filepath.Join(configHome, "user-dirs.dirs")
	}

	file, err := os.Open(configPath)
	if err == nil {
		defer file.Close()
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if !strings.HasPrefix(line, "XDG_DOWNLOAD_DIR=") {
				continue
			}
			value := strings.TrimSpace(strings.TrimPrefix(line, "XDG_DOWNLOAD_DIR="))
			value = strings.Trim(value, `"'`)
			if value != "" {
				return expandDownloadDirValue(value, home), nil
			}
		}
		if err := scanner.Err(); err != nil {
			return "", err
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}

	return filepath.Join(home, "Downloads"), nil
}

func expandDownloadDirValue(value string, home string) string {
	expanded := os.Expand(value, func(name string) string {
		switch name {
		case "HOME":
			return home
		default:
			return os.Getenv(name)
		}
	})
	if filepath.IsAbs(expanded) {
		return filepath.Clean(expanded)
	}
	return filepath.Clean(filepath.Join(home, expanded))
}

func ensureDownloadDir(dir string) (string, error) {
	trimmed := strings.TrimSpace(dir)
	if trimmed == "" {
		return "", fmt.Errorf("download dir is required")
	}
	absoluteDir, err := filepath.Abs(trimmed)
	if err != nil {
		return "", fmt.Errorf("resolve download dir %q: %w", dir, err)
	}
	if err := os.MkdirAll(absoluteDir, 0o755); err != nil {
		return "", fmt.Errorf("create downloads dir %q: %w", absoluteDir, err)
	}
	return filepath.Clean(absoluteDir), nil
}

func validateDownloadDir(dir string, allowInsideDataDir bool) (string, error) {
	validatedDir := strings.TrimSpace(dir)
	if validatedDir == "" {
		defaultDir, err := defaultDownloadsDir()
		if err != nil {
			return "", err
		}
		validatedDir = defaultDir
	}
	if !filepath.IsAbs(validatedDir) {
		return "", fmt.Errorf("download dir must be absolute")
	}
	validatedDir, err := ensureDownloadDir(validatedDir)
	if err != nil {
		return "", err
	}
	if !allowInsideDataDir {
		dataDir, err := DataDir()
		if err != nil {
			return "", err
		}
		insideDataDir, err := pathInsideBase(validatedDir, dataDir)
		if err != nil {
			return "", err
		}
		if insideDataDir {
			return "", fmt.Errorf("download dir cannot be inside data dir")
		}
	}

	probe, err := os.CreateTemp(validatedDir, ".tuyuldm-write-check-*")
	if err != nil {
		return "", fmt.Errorf("download dir is not writable: %w", err)
	}
	probePath := probe.Name()
	if closeErr := probe.Close(); closeErr != nil {
		return "", closeErr
	}
	_ = os.Remove(probePath)
	return validatedDir, nil
}

func pathInsideBase(target string, base string) (bool, error) {
	absoluteTarget, err := filepath.Abs(target)
	if err != nil {
		return false, err
	}
	absoluteBase, err := filepath.Abs(base)
	if err != nil {
		return false, err
	}
	rel, err := filepath.Rel(absoluteBase, absoluteTarget)
	if err != nil {
		return false, err
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))), nil
}

func legacyDownloadsDirPath() (string, error) {
	root, err := DataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "downloads"), nil
}

func migratedLegacyDownloadDir() (string, bool, error) {
	legacyDir, err := legacyDownloadsDirPath()
	if err != nil {
		return "", false, err
	}
	entries, err := os.ReadDir(legacyDir)
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, err
	}
	return legacyDir, len(entries) > 0, nil
}

func sameCleanPath(left string, right string) bool {
	if strings.TrimSpace(left) == "" || strings.TrimSpace(right) == "" {
		return false
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
