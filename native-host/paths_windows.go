//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func resolveWindowsDownloadsDir() (string, error) {
	path, err := windows.KnownFolderPath(windows.FOLDERID_Downloads, 0)
	if err == nil && strings.TrimSpace(path) != "" {
		return path, nil
	}
	if userProfile := strings.TrimSpace(os.Getenv("USERPROFILE")); userProfile != "" {
		return filepath.Join(userProfile, "Downloads"), nil
	}
	home, homeErr := os.UserHomeDir()
	if homeErr != nil {
		if err != nil {
			return "", err
		}
		return "", homeErr
	}
	return filepath.Join(home, "Downloads"), nil
}