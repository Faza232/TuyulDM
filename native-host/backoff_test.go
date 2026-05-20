package main

import (
	"testing"
	"time"
)

func TestBackoffDelayAppliesJitterAndCap(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		attempt int
		base    time.Duration
	}{
		{attempt: 0, base: 1 * time.Second},
		{attempt: 1, base: 2 * time.Second},
		{attempt: 2, base: 4 * time.Second},
		{attempt: 3, base: 8 * time.Second},
		{attempt: 4, base: 16 * time.Second},
		{attempt: 10, base: 30 * time.Second},
	}

	for _, tc := range testCases {
		delay := backoffDelay(tc.attempt)
		minimum := time.Duration(float64(tc.base) * 0.8)
		maximum := time.Duration(float64(tc.base) * 1.2)
		if maximum > maxBackoffDelay {
			maximum = maxBackoffDelay
		}
		if delay < minimum || delay > maximum {
			t.Fatalf("attempt %d: expected delay in [%s, %s], got %s", tc.attempt, minimum, maximum, delay)
		}
	}
}

func TestRetryDelayFromHeaderClampsAndFallsBack(t *testing.T) {
	t.Parallel()

	if delay, used := retryDelayFromHeader("5", 0); !used || delay != 5*time.Second {
		t.Fatalf("expected Retry-After header to produce 5s delay, got used=%t delay=%s", used, delay)
	}

	if delay, used := retryDelayFromHeader("0", 0); !used || delay != time.Second {
		t.Fatalf("expected Retry-After 0 to clamp to 1s, got used=%t delay=%s", used, delay)
	}

	if delay, used := retryDelayFromHeader("999999", 0); !used || delay != 5*time.Minute {
		t.Fatalf("expected huge Retry-After to clamp to 5m, got used=%t delay=%s", used, delay)
	}

	if delay, used := retryDelayFromHeader("bogus", 0); used || delay < 800*time.Millisecond || delay > 1200*time.Millisecond {
		t.Fatalf("expected malformed Retry-After to fall back to attempt 0 backoff, got used=%t delay=%s", used, delay)
	}
}
