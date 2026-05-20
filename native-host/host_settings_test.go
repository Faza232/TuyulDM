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