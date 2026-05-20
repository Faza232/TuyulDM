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
		out, _ := json.Marshal(msg)
		WriteMessage(os.Stdout, out)
	})
	if err := storage.PauseActiveDownloads(); err != nil {
		slog.Warn("pause stale downloads failed", "error", err)
	}
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
			requestCtx, cancel := context.WithCancel(hostCtx)
			state, err := engine.Add(requestCtx, params)
			cancel()
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
				resp.Payload = state
				// Auto-start for now
				engine.Start(state.ID)
			}
		case "download.video":
			var params VideoDownloadRequest
			if err := decodeParams(req, &params); err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
				break
			}
			requestCtx, cancel := context.WithCancel(hostCtx)
			state, err := engine.AddVideo(requestCtx, params)
			cancel()
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
				resp.Payload = state
				// Auto-start for now
				engine.Start(state.ID)
			}
		case "download.pause":
			var params struct {
				ID string `json:"id"`
			}
			if err := decodeParams(req, &params); err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
				break
			}
			if err := engine.Pause(params.ID); err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
			}
		case "download.pauseAll":
			list, err := storage.ListDownloads()
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else if err := pauseAllDownloads(engine, list); err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
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
			err := engine.Resume(params.ID)
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
			state, err := engine.RefreshURL(params.ID, params.URL, params.Force, params.RestartFromScratch)
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
				resp.Payload = errorResponsePayload(err)
			} else {
				resp.Status = "ok"
				resp.Payload = state
			}
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
			if err := engine.Remove(params.ID, params.DeleteFile); err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
			}
		case "download.resumeAll":
			list, err := storage.ListDownloads()
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else if err := resumeAllDownloads(engine, list); err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
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

			out, _ := json.Marshal(resp)
			if err := WriteMessage(os.Stdout, out); err != nil {
				slog.Error("write message failed", "error", err, "request_id", req.ID)
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

func pauseAllDownloads(engine *Engine, downloads []DownloadState) error {
	for i := range downloads {
		switch downloads[i].Status {
		case "downloading", "muxing", "queued":
			if err := engine.Pause(downloads[i].ID); err != nil {
				return err
			}
		}
	}

	return nil
}

func resumeAllDownloads(engine *Engine, downloads []DownloadState) error {
	for _, download := range downloads {
		if download.Status != "paused" && download.Status != "queued" {
			continue
		}

		if err := engine.Resume(download.ID); err != nil && err.Error() != "already active" {
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

