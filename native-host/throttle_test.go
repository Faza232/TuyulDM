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

func TestStallWatchReaderCancelsStalledRead(t *testing.T) {
	reqCtx, cancel := context.WithCancelCause(context.Background())
	started := make(chan struct{})
	reader := newStallWatchReader(reqCtx, &blockingReader{ctx: reqCtx, started: started}, cancel, 50*time.Millisecond)
	defer reader.Stop()

	done := make(chan error, 1)
	go func() {
		_, err := reader.Read(make([]byte, 1))
		done <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for blocking read to start")
	}

	select {
	case err := <-done:
		if downloadErrorCode(err) != "network_stall" {
			t.Fatalf("expected network_stall read error, got %v", err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("timed out waiting for stalled read to cancel")
	}

	if downloadErrorCode(context.Cause(reqCtx)) != "network_stall" {
		t.Fatalf("expected context cause network_stall, got %v", context.Cause(reqCtx))
	}
}

type blockingReader struct {
	ctx     context.Context
	started chan struct{}
}

func (reader *blockingReader) Read(buffer []byte) (int, error) {
	select {
	case <-reader.started:
	default:
		close(reader.started)
	}
	<-reader.ctx.Done()
	return 0, reader.ctx.Err()
}
