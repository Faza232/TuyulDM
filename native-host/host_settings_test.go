package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStorageGetHostSettingsMigratesLegacyDownloadsDir(t *testing.T) {
	xdgDataHome := t.TempDir()
	t.Setenv("XDG_DATA_HOME", xdgDataHome)
	storage := newTestStorage(t)
	legacyDir, err := legacyDownloadsDirPath()
	if err != nil {
		t.Fatalf("legacyDownloadsDirPath returned error: %v", err)
	}
	if err := os.MkdirAll(legacyDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	legacyFile := filepath.Join(legacyDir, "existing.bin")
	if err := os.WriteFile(legacyFile, []byte("old"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	settings, err := storage.GetHostSettings()
	if err != nil {
		t.Fatalf("GetHostSettings returned error: %v", err)
	}
	if settings.DownloadDir != legacyDir {
		t.Fatalf("expected migrated download dir %q, got %q", legacyDir, settings.DownloadDir)
	}
}

func TestNormalizeHostSettingsClampsSegmentStallTimeout(t *testing.T) {
	testCases := []struct {
		name     string
		input    int
		expected int
	}{
		{name: "default", input: 0, expected: defaultSegmentStallTimeoutSec},
		{name: "minimum", input: 1, expected: minSegmentStallTimeoutSec},
		{name: "maximum", input: 999, expected: maxSegmentStallTimeoutSec},
	}

	for _, tc := range testCases {
		settings := normalizeHostSettings(HostSettings{SegmentStallTimeoutSec: tc.input})
		if settings.SegmentStallTimeoutSec != tc.expected {
			t.Fatalf("%s: expected stall timeout %d, got %d", tc.name, tc.expected, settings.SegmentStallTimeoutSec)
		}
	}
}

func TestNormalizeHostSettingsClampsMaxSegmentsPerDownload(t *testing.T) {
	testCases := []struct {
		name     string
		input    int
		expected int
	}{
		{name: "default", input: 0, expected: defaultMaxSegmentsPerDownload},
		{name: "minimum", input: 1, expected: 1},
		{name: "maximum", input: 999, expected: maxSegmentsPerDownloadLimit},
	}

	for _, tc := range testCases {
		settings := normalizeHostSettings(HostSettings{MaxSegmentsPerDownload: tc.input})
		if settings.MaxSegmentsPerDownload != tc.expected {
			t.Fatalf("%s: expected max segments %d, got %d", tc.name, tc.expected, settings.MaxSegmentsPerDownload)
		}
	}
}
