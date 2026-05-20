package main

import (
	"context"
	"io"
	"sync/atomic"

	"golang.org/x/time/rate"
)

const throttleChunkSize = 16 * 1024

type throttledReader struct {
	ctx    context.Context
	r      io.Reader
	perDl  *atomic.Pointer[rate.Limiter]
	global *rate.Limiter
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
