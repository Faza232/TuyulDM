//go:build !windows

package main

import (
	"fmt"
	"runtime"
)

func resolveWindowsDownloadsDir() (string, error) {
	return "", fmt.Errorf("windows downloads dir unavailable on %s", runtime.GOOS)
}