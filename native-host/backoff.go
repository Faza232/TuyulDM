package main

import (
	"math/rand"
	"net/http"
	"strings"
	"time"
)

const (
	minRetryDelay   = time.Second
	maxRetryDelay   = 5 * time.Minute
	maxBackoffDelay = 30 * time.Second
)

// backoffDelay returns the wait before the Nth retry (0-indexed).
// 1s, 2s, 4s, 8s, 16s, capped at 30s, with +/-20% jitter.
func backoffDelay(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}

	delay := minRetryDelay << attempt
	if delay > maxBackoffDelay || delay < 0 {
		delay = maxBackoffDelay
	}

	jitterFactor := 0.8 + rand.Float64()*0.4
	jittered := time.Duration(float64(delay) * jitterFactor)
	return clampDuration(jittered, minRetryDelay, maxBackoffDelay)
}

func retryDelayFromHeader(value string, attempt int) (time.Duration, bool) {
	if parsed, ok := parseRetryAfterHeader(value); ok {
		return clampDuration(parsed, minRetryDelay, maxRetryDelay), true
	}
	return backoffDelay(attempt), false
}

func parseRetryAfter(value string) time.Duration {
	if parsed, ok := parseRetryAfterHeader(value); ok {
		return clampDuration(parsed, minRetryDelay, maxRetryDelay)
	}
	return minRetryDelay
}

func parseRetryAfterHeader(value string) (time.Duration, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false
	}

	if seconds, err := time.ParseDuration(trimmed + "s"); err == nil {
		return seconds, true
	}

	if retryAt, err := http.ParseTime(trimmed); err == nil {
		return time.Until(retryAt), true
	}

	return 0, false
}

func clampDuration(value time.Duration, minimum time.Duration, maximum time.Duration) time.Duration {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
