package main

import (
	"context"
	"io"

	"golang.org/x/time/rate"
)

const throttleChunkSize = 16 * 1024

type throttledReader struct {
	ctx    context.Context
	r      io.Reader
	perDl  *rate.Limiter
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

func newThrottledReader(ctx context.Context, reader io.Reader, perDl *rate.Limiter, global *rate.Limiter) io.Reader {
	if perDl == nil && global == nil {
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
	maxChunk := len(buffer)
	if maxChunk > throttleChunkSize {
		maxChunk = throttleChunkSize
	}
	if reader.perDl != nil && reader.perDl.Burst() < maxChunk {
		maxChunk = reader.perDl.Burst()
	}
	if reader.global != nil && reader.global.Burst() < maxChunk {
		maxChunk = reader.global.Burst()
	}
	if maxChunk < 1 {
		maxChunk = 1
	}

	count, err := reader.r.Read(buffer[:maxChunk])
	if count > 0 {
		if reader.perDl != nil {
			if waitErr := reader.perDl.WaitN(reader.ctx, count); waitErr != nil {
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
