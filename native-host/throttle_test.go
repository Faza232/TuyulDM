package main

import (
	"context"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestThrottledReaderPacesReads(t *testing.T) {
	var perDownloadLimiter atomic.Pointer[rate.Limiter]
	perDownloadLimiter.Store(rate.NewLimiter(rate.Limit(20), 1))

	reader := newThrottledReader(
		context.Background(),
		strings.NewReader("abcd"),
		&perDownloadLimiter,
		rate.NewLimiter(rate.Limit(40), 1),
	)

	started := time.Now()
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("ReadAll returned error: %v", err)
	}
	if string(data) != "abcd" {
		t.Fatalf("unexpected data: %q", string(data))
	}

	if elapsed := time.Since(started); elapsed < 120*time.Millisecond {
		t.Fatalf("expected throttled read to take at least 120ms, got %s", elapsed)
	}
}

func TestThrottledReaderReloadsPerDownloadLimiter(t *testing.T) {
	var perDownloadLimiter atomic.Pointer[rate.Limiter]
	perDownloadLimiter.Store(rate.NewLimiter(rate.Limit(1000), 1))

	reader := newThrottledReader(
		context.Background(),
		strings.NewReader("abc"),
		&perDownloadLimiter,
		nil,
	)

	buffer := make([]byte, 1)
	if _, err := reader.Read(buffer); err != nil {
		t.Fatalf("first read returned error: %v", err)
	}

	perDownloadLimiter.Store(rate.NewLimiter(rate.Limit(5), 1))
	if _, err := reader.Read(buffer); err != nil {
		t.Fatalf("second read returned error: %v", err)
	}
	started := time.Now()
	if _, err := reader.Read(buffer); err != nil {
		t.Fatalf("third read returned error: %v", err)
	}
	if elapsed := time.Since(started); elapsed < 180*time.Millisecond {
		t.Fatalf("expected third read to respect updated limiter, got %s", elapsed)
	}
}
