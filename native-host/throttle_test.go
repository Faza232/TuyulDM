package main

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestThrottledReaderPacesReads(t *testing.T) {
	reader := newThrottledReader(
		context.Background(),
		strings.NewReader("abcd"),
		rate.NewLimiter(rate.Limit(20), 1),
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
