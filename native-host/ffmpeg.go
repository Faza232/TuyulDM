package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func ResolveFFmpegBinary() (string, error) {
	if override := strings.TrimSpace(os.Getenv("TUYULDM_FFMPEG")); override != "" {
		return override, nil
	}

	executablePath, err := os.Executable()
	if err != nil {
		return "", err
	}

	binaryName := bundledFFmpegName()
	candidates := []string{
		filepath.Join(filepath.Dir(executablePath), "bin", binaryName),
		filepath.Join(filepath.Dir(executablePath), binaryName),
	}

	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("bundled ffmpeg not found; expected %s near the daemon binary or set TUYULDM_FFMPEG", binaryName)
}

func bundledFFmpegName() string {
	name := fmt.Sprintf("ffmpeg-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}