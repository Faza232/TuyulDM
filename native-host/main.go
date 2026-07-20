package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     int             `json:"id"`
}

type Response struct {
	Status  string      `json:"status"`
	Message string      `json:"message"`
	Payload interface{} `json:"payload,omitempty"`
	ID      int         `json:"id"`
}

type HostStatsPayload struct {
	GlobalSpeedBytesPerSecond int64  `json:"globalSpeedBytesPerSecond"`
	FreeSpaceBytes            uint64 `json:"freeSpaceBytes"`
	ActiveDownloads           int    `json:"activeDownloads"`
}

type readLoopResult struct {
	payload []byte
	err     error
}

type pendingDownloadRequest struct {
	cancel context.CancelFunc
}

type pendingDownloadRequests struct {
	mu   sync.Mutex
	byID map[string]*pendingDownloadRequest
}

func newPendingDownloadRequests() *pendingDownloadRequests {
	return &pendingDownloadRequests{byID: make(map[string]*pendingDownloadRequest)}
}

func (pending *pendingDownloadRequests) register(id string, cancel context.CancelFunc) func() {
	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" || cancel == nil {
		return func() {}
	}

	entry := &pendingDownloadRequest{cancel: cancel}
	pending.mu.Lock()
	pending.byID[trimmedID] = entry
	pending.mu.Unlock()

	return func() {
		pending.mu.Lock()
		if pending.byID[trimmedID] == entry {
			delete(pending.byID, trimmedID)
		}
		pending.mu.Unlock()
	}
}

func (pending *pendingDownloadRequests) cancel(id string) bool {
	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" {
		return false
	}

	pending.mu.Lock()
	entry, ok := pending.byID[trimmedID]
	if ok {
		delete(pending.byID, trimmedID)
	}
	pending.mu.Unlock()
	if ok {
		entry.cancel()
	}
	return ok
}

func isDownloadNotFoundError(err error) bool {
	return err != nil && err.Error() == "download not found"
}

func errorResponsePayload(err error) interface{} {
	var coded *codedError
	if !errors.As(err, &coded) {
		return nil
	}
	payload := map[string]interface{}{
		"code": coded.Code,
	}
	if coded.Payload != nil {
		payload["details"] = coded.Payload
	}
	return payload
}

func main() {
	configureBootstrapLogger()
	slog.Info("native host starting")
	hostCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	pendingRequests := newPendingDownloadRequests()
	var writeMu sync.Mutex
	writeResponse := func(resp Response) bool {
		writeMu.Lock()
		defer writeMu.Unlock()

		out, _ := json.Marshal(resp)
		if err := WriteMessage(os.Stdout, out); err != nil {
			slog.Error("write message failed", "error", err, "request_id", resp.ID)
			stopSignals()
			return false
		}
		return true
	}

	dataDir, err := DataDir()
	if err != nil {
		slog.Error("resolve data dir failed", "error", err)
		return
	}

	storage, err := NewStorage(filepath.Join(dataDir, "tuyuldm.db"))
	if err != nil {
		slog.Error("open storage failed", "error", err, "data_dir", dataDir)
		return
	}
	settings, settingsErr := storage.GetHostSettings()
	if settingsErr != nil {
		slog.Warn("load host settings failed; using defaults", "error", settingsErr)
		settings = defaultHostSettings()
	}
	if err := configureHostLogger(settings); err != nil {
		slog.Error("configure host logger failed", "error", err, "data_dir", dataDir)
	} else {
		slog.Info("host logger ready", "path", filepath.Join(dataDir, "logs", hostLogFileName), "level", normalizeHostLogLevel(settings.LogLevel))
	}
	slog.Info("native host started", "data_dir", dataDir)

	engine := NewEngine(storage, func(state DownloadState) {
		msg := Response{
			Status:  "ok",
			Message: "download.progressUpdate",
			Payload: state,
			ID:      0, // Event messages can have ID 0
		}
		writeResponse(msg)
	})
	if err := storage.PauseActiveDownloads(); err != nil {
		slog.Warn("pause stale downloads failed", "error", err)
	}
	offerCache := newMediaOfferCache()
	adapterRegistry := NewSiteAdapterRegistry()
	adapterRegistry.Register(NewExternalResolverAdapter())
	SetActiveResolverContext(&ResolverContext{
		Adapters: adapterRegistry,
		Settings: engine.HostSettings,
	})
	scheduler := newDownloadScheduler(storage, engine)
	if err := scheduler.Reconcile(time.Now()); err != nil {
		slog.Warn("initial scheduler reconcile failed", "error", err)
	}
	schedulerCtx, cancelScheduler := context.WithCancel(hostCtx)
	go scheduler.Start(schedulerCtx)

	readResults := make(chan readLoopResult)
	go func() {
		for {
			payload, err := ReadMessage(os.Stdin)
			readResults <- readLoopResult{payload: payload, err: err}
			if err != nil {
				close(readResults)
				return
			}
		}
	}()

	shutdownReason := "stdin closed"
readLoop:
	for {
		select {
		case <-hostCtx.Done():
			shutdownReason = "signal received"
			break readLoop
		case result, ok := <-readResults:
			if !ok {
				break readLoop
			}
			payload, err := result.payload, result.err
			if err != nil {
				if err != io.EOF {
					slog.Error("read message failed", "error", err)
				}
				break readLoop
			}

			var req Request
			if err := json.Unmarshal(payload, &req); err != nil {
				slog.Error("unmarshal request failed", "error", err)
				continue
			}

			var resp Response
			resp.ID = req.ID
			dispatchAsync := func(pendingID string, handler func(context.Context) Response) {
				requestCtx, cancel := context.WithCancel(hostCtx)
				unregister := pendingRequests.register(pendingID, cancel)
				go func() {
					defer cancel()
					defer unregister()
					writeResponse(handler(requestCtx))
				}()
			}

			switch req.Method {
			case "ping":
				resp.Status = "ok"
				resp.Message = "pong"
			case "video.inspect":
				var params VideoDownloadRequest
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				requestCtx, cancel := context.WithCancel(hostCtx)
				preview, err := previewVideoManifest(requestCtx, params)
				cancel()
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = preview
				}
			case "download.add":
				var params DownloadRequest
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				dispatchAsync(params.ID, func(requestCtx context.Context) Response {
					resp := Response{ID: req.ID}
					state, err := engine.Add(requestCtx, params)
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
						return resp
					}
					resp.Status = "ok"
					resp.Payload = state
					_ = engine.Start(state.ID)
					return resp
				})
				continue
			case "download.video":
				var params VideoDownloadRequest
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				// Resolve the manifest (several YouTube round-trips) off the read
				// loop so other messages are not blocked while it runs.
				dispatchAsync("", func(requestCtx context.Context) Response {
					resp := Response{ID: req.ID}
					state, err := engine.AddVideo(requestCtx, params)
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
						return resp
					}
					resp.Status = "ok"
					resp.Payload = state
					_ = engine.Start(state.ID)
					return resp
				})
				continue
			case "media.resolve":
				var params MediaResolveRequest
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				requestCtx, cancel := context.WithCancel(hostCtx)
				offer, err := ResolveMediaOffer(requestCtx, params)
				cancel()
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					offerCache.Put(offer)
					resp.Status = "ok"
					resp.Payload = offer
				}
			case "offer.refresh":
				var params OfferRefreshRequest
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				dispatchAsync(params.DownloadID, func(requestCtx context.Context) Response {
					resp := Response{ID: req.ID}
					result, err := engine.RefreshOffer(requestCtx, offerCache, params)
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
						if result != nil {
							resp.Payload = result
						}
						return resp
					}
					resp.Status = "ok"
					resp.Payload = result
					return resp
				})
				continue
			case "media.download":
				var params MediaDownloadRequest
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				offer, err := offerCache.Get(params.OfferID)
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				dispatchAsync(params.OfferID, func(requestCtx context.Context) Response {
					resp := Response{ID: req.ID}
					state, err := engine.AddMediaOffer(requestCtx, offer, params)
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
						return resp
					}
					resp.Status = "ok"
					resp.Payload = state
					_ = engine.Start(state.ID)
					return resp
				})
				continue
			case "download.pause":
				var params struct {
					ID string `json:"id"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				canceledPending := pendingRequests.cancel(params.ID)
				requestCtx, cancel := context.WithCancel(hostCtx)
				if err := engine.Pause(requestCtx, params.ID); err != nil {
					if canceledPending && isDownloadNotFoundError(err) {
						resp.Status = "ok"
					} else {
						resp.Status = "error"
						resp.Message = err.Error()
					}
				} else {
					resp.Status = "ok"
				}
				cancel()
			case "download.pauseAll":
				list, err := storage.ListDownloads()
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					requestCtx, cancel := context.WithCancel(hostCtx)
					err = pauseAllDownloads(requestCtx, engine, list)
					cancel()
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
					} else {
						resp.Status = "ok"
					}
				}
			case "download.resume":
				var params struct {
					ID string `json:"id"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				requestCtx, cancel := context.WithCancel(hostCtx)
				err := engine.Resume(requestCtx, params.ID)
				cancel()
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
				}
			case "download.refreshUrl":
				var params struct {
					ID                 string `json:"id"`
					URL                string `json:"url"`
					Force              bool   `json:"force,omitempty"`
					RestartFromScratch bool   `json:"restartFromScratch,omitempty"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				dispatchAsync(params.ID, func(requestCtx context.Context) Response {
					resp := Response{ID: req.ID}
					state, err := engine.RefreshURL(requestCtx, params.ID, params.URL, params.Force, params.RestartFromScratch)
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
						resp.Payload = errorResponsePayload(err)
						return resp
					}
					resp.Status = "ok"
					resp.Payload = state
					return resp
				})
				continue
			case "download.remove":
				var params struct {
					ID         string `json:"id"`
					DeleteFile bool   `json:"deleteFile"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				canceledPending := pendingRequests.cancel(params.ID)
				requestCtx, cancel := context.WithCancel(hostCtx)
				if err := engine.Remove(requestCtx, params.ID, params.DeleteFile); err != nil {
					if canceledPending && isDownloadNotFoundError(err) {
						resp.Status = "ok"
					} else {
						resp.Status = "error"
						resp.Message = err.Error()
					}
				} else {
					resp.Status = "ok"
				}
				cancel()
			case "download.resumeAll":
				list, err := storage.ListDownloads()
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					requestCtx, cancel := context.WithCancel(hostCtx)
					err = resumeAllDownloads(requestCtx, engine, list)
					cancel()
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
					} else {
						resp.Status = "ok"
					}
				}
			case "download.list":
				list, _ := storage.ListDownloads()
				resp.Status = "ok"
				resp.Payload = list
			case "host.getStats":
				list, err := storage.ListDownloads()
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}

				downloadsDir, err := ResolveDownloadDir(engine.HostSettings())
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}

				freeSpaceBytes, err := DiskFreeBytes(downloadsDir)
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}

				resp.Status = "ok"
				resp.Payload = HostStatsPayload{
					GlobalSpeedBytesPerSecond: aggregateGlobalSpeed(list),
					FreeSpaceBytes:            freeSpaceBytes,
					ActiveDownloads:           countActiveDownloads(list),
				}
			case "host.getSettings":
				resp.Status = "ok"
				resp.Payload = engine.HostSettings()
			case "host.setSettings":
				current := engine.HostSettings()
				var params HostSettingsUpdate
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}

				nextSettings := applyHostSettingsUpdate(current, params)
				if err := engine.UpdateHostSettings(nextSettings); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = engine.HostSettings()
				}
			case "host.setThrottle":
				current := engine.HostSettings()
				var params struct {
					GlobalThrottleBytesPerSecond      *int64 `json:"globalThrottleBytesPerSecond,omitempty"`
					PerDownloadThrottleBytesPerSecond *int64 `json:"perDownloadThrottleBytesPerSecond,omitempty"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}

				nextSettings := applyHostSettingsUpdate(current, HostSettingsUpdate{
					GlobalThrottleBytesPerSecond:      params.GlobalThrottleBytesPerSecond,
					PerDownloadThrottleBytesPerSecond: params.PerDownloadThrottleBytesPerSecond,
				})
				if err := engine.UpdateHostSettings(nextSettings); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = engine.HostSettings()
				}
			case "host.openLogs":
				logPath, err := ensureHostLogFile()
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				if err := openFilePath(logPath); err != nil {
					slog.Error("open logs failed", "error", err, "path", logPath)
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = map[string]string{"path": logPath}
				}
			case "host.openFile":
				var params struct {
					ID string `json:"id"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				state, err := storage.GetDownload(params.ID)
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				outputPath, err := resolveDownloadOpenPath(state, engine.HostSettings())
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				if err := openFilePath(outputPath); err != nil {
					slog.Error("open download file failed", "error", err, "download_id", state.ID, "path", outputPath)
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = map[string]string{"path": outputPath}
				}
			case "host.revealInFolder":
				var params struct {
					ID string `json:"id"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				state, err := storage.GetDownload(params.ID)
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				outputPath, err := resolveDownloadRevealPath(state, engine.HostSettings())
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				if err := revealFileInFolder(outputPath); err != nil {
					slog.Error("reveal download file failed", "error", err, "download_id", state.ID, "path", outputPath)
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = map[string]string{"path": outputPath}
				}
			case "host.pickDirectory":
				var params struct {
					Initial string `json:"initial,omitempty"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
					break
				}
				selectedPath, err := pickDirectory(params.Initial)
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = map[string]string{"path": selectedPath}
				}
			case "download.getProgress":
				var params struct {
					ID string `json:"id"`
				}
				if err := decodeParams(req, &params); err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					state, err := storage.GetDownload(params.ID)
					if err != nil {
						resp.Status = "error"
						resp.Message = err.Error()
					} else {
						resp.Status = "ok"
						resp.Payload = state
					}
				}
			default:
				resp.Status = "error"
				resp.Message = "Unknown method: " + req.Method
				slog.Warn("unknown IPC method", "method", req.Method, "request_id", req.ID)
			}

			if !writeResponse(resp) {
				break readLoop
			}
		}
	}

	cancelScheduler()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := engine.Shutdown(shutdownCtx); err != nil {
		slog.Warn("engine shutdown incomplete", "reason", shutdownReason, "error", err)
	} else {
		slog.Info("engine shutdown complete", "reason", shutdownReason)
	}
	if err := storage.db.Close(); err != nil {
		slog.Warn("storage close failed", "error", err)
	}
}

func decodeParams(req Request, target interface{}) error {
	if len(req.Params) == 0 || string(req.Params) == "null" {
		return nil
	}
	if err := json.Unmarshal(req.Params, target); err != nil {
		slog.Error("unmarshal request params failed", "error", err, "method", req.Method, "request_id", req.ID)
		return err
	}
	return nil
}

func pauseAllDownloads(ctx context.Context, engine *Engine, downloads []DownloadState) error {
	for i := range downloads {
		switch downloads[i].Status {
		case "downloading", "muxing", "queued":
			if err := engine.Pause(ctx, downloads[i].ID); err != nil {
				return err
			}
		}
	}

	return nil
}

func resumeAllDownloads(ctx context.Context, engine *Engine, downloads []DownloadState) error {
	for _, download := range downloads {
		if download.Status != "paused" && download.Status != "queued" {
			continue
		}

		if err := engine.Resume(ctx, download.ID); err != nil && err.Error() != "already active" {
			return err
		}
	}

	return nil
}

func aggregateGlobalSpeed(downloads []DownloadState) int64 {
	var total int64
	for _, download := range downloads {
		if download.SpeedBytesPerSecond > 0 {
			total += download.SpeedBytesPerSecond
		}
	}
	return total
}

func countActiveDownloads(downloads []DownloadState) int {
	count := 0
	for _, download := range downloads {
		if download.Status == "downloading" || download.Status == "queued" || download.Status == "muxing" {
			count++
		}
	}
	return count
}
