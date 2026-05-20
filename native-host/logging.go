package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	lumberjack "gopkg.in/natefinch/lumberjack.v2"
)

const (
	defaultHostLogLevel = "info"
	hostLogFileName     = "tuyuldm.log"
	hostLogMaxSizeMB    = 10
	hostLogMaxBackups   = 5
)

var hostLogWriter struct {
	mu     sync.Mutex
	closer io.Closer
}

func configureBootstrapLogger() {
	slog.SetDefault(newHostLogger(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))
}

func configureHostLogger(settings HostSettings) error {
	path, err := ensureHostLogFile()
	if err != nil {
		return err
	}

	level := parseHostLogLevel(settings.LogLevel)
	writer := &lumberjack.Logger{
		Filename:   path,
		MaxSize:    hostLogMaxSizeMB,
		MaxBackups: hostLogMaxBackups,
	}

	handlers := []slog.Handler{
		slog.NewJSONHandler(writer, &slog.HandlerOptions{Level: level}),
		slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}),
	}
	slog.SetDefault(newHostLogger(newFanoutHandler(handlers...)))

	hostLogWriter.mu.Lock()
	defer hostLogWriter.mu.Unlock()
	if hostLogWriter.closer != nil {
		_ = hostLogWriter.closer.Close()
	}
	hostLogWriter.closer = writer
	return nil
}

func HostLogsDir() (string, error) {
	root, err := DataDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func HostLogFilePath() (string, error) {
	dir, err := HostLogsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, hostLogFileName), nil
}

func ensureHostLogFile() (string, error) {
	path, err := HostLogFilePath()
	if err != nil {
		return "", err
	}
	file, err := os.OpenFile(path, os.O_CREATE, 0o644)
	if err != nil {
		return "", err
	}
	_ = file.Close()
	return path, nil
}

func newHostLogger(handler slog.Handler) *slog.Logger {
	return slog.New(handler)
}

func parseHostLogLevel(raw string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func normalizeHostLogLevel(raw string) string {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	switch trimmed {
	case "debug", "info", "warn", "warning", "error":
		if trimmed == "warning" {
			return "warn"
		}
		return trimmed
	default:
		return defaultHostLogLevel
	}
}

func trimLogTail(output []byte, maxBytes int) string {
	trimmed := strings.TrimSpace(string(output))
	if maxBytes <= 0 || len(trimmed) <= maxBytes {
		return trimmed
	}
	return trimmed[len(trimmed)-maxBytes:]
}

type fanoutHandler struct {
	handlers []slog.Handler
}

func newFanoutHandler(handlers ...slog.Handler) slog.Handler {
	return fanoutHandler{handlers: append([]slog.Handler(nil), handlers...)}
}

func (h fanoutHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (h fanoutHandler) Handle(ctx context.Context, record slog.Record) error {
	for _, handler := range h.handlers {
		if !handler.Enabled(ctx, record.Level) {
			continue
		}
		if err := handler.Handle(ctx, record.Clone()); err != nil {
			return err
		}
	}
	return nil
}

func (h fanoutHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		next = append(next, handler.WithAttrs(attrs))
	}
	return fanoutHandler{handlers: next}
}

func (h fanoutHandler) WithGroup(name string) slog.Handler {
	next := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		next = append(next, handler.WithGroup(name))
	}
	return fanoutHandler{handlers: next}
}