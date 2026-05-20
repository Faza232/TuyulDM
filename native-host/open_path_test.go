package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolveDownloadOpenPathRequiresFinishedStatus(t *testing.T) {
	downloadDir := t.TempDir()
	outputPath := filepath.Join(downloadDir, "file.bin")
	if err := os.WriteFile(outputPath, []byte("data"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	_, err := resolveDownloadOpenPath(&DownloadState{
		Filename:   "file.bin",
		OutputPath: outputPath,
		Status:     "paused",
		CreatedAt:  time.Now(),
	}, HostSettings{DownloadDir: downloadDir})
	if err == nil {
		t.Fatal("expected open path resolution to reject unfinished download")
	}
}

func TestResolveDownloadOutputPathRejectsEscapedPath(t *testing.T) {
	downloadDir := t.TempDir()
	outsidePath := filepath.Join(t.TempDir(), "outside.bin")

	_, err := resolveDownloadOutputPath(&DownloadState{
		Filename:   "outside.bin",
		OutputPath: outsidePath,
		Status:     "finished",
		CreatedAt:  time.Now(),
	}, HostSettings{DownloadDir: downloadDir})
	if err == nil {
		t.Fatal("expected escaped path to be rejected")
	}
}

func TestResolveDownloadRevealPathAcceptsFileInsideConfiguredDir(t *testing.T) {
	downloadDir := t.TempDir()
	outputPath := filepath.Join(downloadDir, "inside.bin")
	if err := os.WriteFile(outputPath, []byte("data"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	resolvedPath, err := resolveDownloadRevealPath(&DownloadState{
		Filename:   "inside.bin",
		OutputPath: outputPath,
		Status:     "paused",
		CreatedAt:  time.Now(),
	}, HostSettings{DownloadDir: downloadDir})
	if err != nil {
		t.Fatalf("resolveDownloadRevealPath returned error: %v", err)
	}
	if resolvedPath != outputPath {
		t.Fatalf("expected resolved path %q, got %q", outputPath, resolvedPath)
	}
}