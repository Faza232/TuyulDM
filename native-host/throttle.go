package main

import (
	"context"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"
)

const throttleChunkSize = 16 * 1024
const stallWatchCheckInterval = 5 * time.Second

type throttledReader struct {
	ctx    context.Context
	r      io.Reader
	perDl  *atomic.Pointer[rate.Limiter]
	global *rate.Limiter
}

type stallWatchReader struct {
	ctx          context.Context
	r            io.Reader
	cancel       context.CancelCauseFunc
	timeout      time.Duration
	lastProgress atomic.Int64
	stop         chan struct{}
	stopOnce     sync.Once
}

func newRateLimiter(bytesPerSecond int64) *rate.Limiter {
	if bytesPerSecond <= 0 {
		return nil
	}

	burst := int(bytesPerSecond)
	if burst > throttleChunkSize {
		burst = throttleChunkSize
	}
	if burst < 1 {
		burst = 1
	}

	return rate.NewLimiter(rate.Limit(bytesPerSecond), burst)
}

func newThrottledReader(ctx context.Context, reader io.Reader, perDl *atomic.Pointer[rate.Limiter], global *rate.Limiter) io.Reader {
	if (perDl == nil || perDl.Load() == nil) && global == nil {
		return reader
	}

	return &throttledReader{
		ctx:    ctx,
		r:      reader,
		perDl:  perDl,
		global: global,
	}
}

func newStallWatchReader(ctx context.Context, reader io.Reader, cancel context.CancelCauseFunc, timeout time.Duration) *stallWatchReader {
	stallReader := &stallWatchReader{
		ctx:     ctx,
		r:       reader,
		cancel:  cancel,
		timeout: timeout,
	}
	stallReader.lastProgress.Store(time.Now().UnixNano())
	if timeout > 0 && cancel != nil {
		stallReader.stop = make(chan struct{})
		go stallReader.watch()
	}
	return stallReader
}

func (reader *stallWatchReader) Read(buffer []byte) (int, error) {
	count, err := reader.r.Read(buffer)
	if count > 0 {
		reader.lastProgress.Store(time.Now().UnixNano())
	}
	if err != nil {
		reader.Stop()
		if cause := context.Cause(reader.ctx); cause != nil && !errors.Is(cause, context.Canceled) {
			return count, cause
		}
	}
	return count, err
}

func (reader *stallWatchReader) Stop() {
	if reader.stop == nil {
		return
	}
	reader.stopOnce.Do(func() {
		close(reader.stop)
	})
}

func (reader *stallWatchReader) watch() {
	ticker := time.NewTicker(stallWatchCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			lastProgress := time.Unix(0, reader.lastProgress.Load())
			if time.Since(lastProgress) >= reader.timeout {
				reader.cancel(withErrorCode("network_stall", errors.New("segment stalled")))
				reader.Stop()
				return
			}
		case <-reader.ctx.Done():
			return
		case <-reader.stop:
			return
		}
	}
}

func (reader *throttledReader) Read(buffer []byte) (int, error) {
	perDl := (*rate.Limiter)(nil)
	if reader.perDl != nil {
		perDl = reader.perDl.Load()
	}

	maxChunk := len(buffer)
	if maxChunk > throttleChunkSize {
		maxChunk = throttleChunkSize
	}
	if perDl != nil && perDl.Burst() < maxChunk {
		maxChunk = perDl.Burst()
	}
	if reader.global != nil && reader.global.Burst() < maxChunk {
		maxChunk = reader.global.Burst()
	}
	if maxChunk < 1 {
		maxChunk = 1
	}

	count, err := reader.r.Read(buffer[:maxChunk])
	if count > 0 {
		if perDl != nil {
			if waitErr := perDl.WaitN(reader.ctx, count); waitErr != nil {
				return 0, waitErr
			}
		}
		if reader.global != nil {
			if waitErr := reader.global.WaitN(reader.ctx, count); waitErr != nil {
				return 0, waitErr
			}
		}
	}

	return count, err
}
