package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

func main() {
	configureBootstrapLogger()
	slog.Info("native host starting")

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
	schedulerCtx, cancelScheduler := context.WithCancel(context.Background())
	defer cancelScheduler()
	go scheduler.Start(schedulerCtx)

	for {
		payload, err := ReadMessage(os.Stdin)
		if err != nil {
			if err != io.EOF {
				slog.Error("read message failed", "error", err)
			}
			break
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
			preview, err := previewVideoManifest(storageContext(), params)
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
			state, err := engine.Add(params)
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
			state, err := engine.AddVideo(params)
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
			if err := openPathInDefaultApp(logPath); err != nil {
				slog.Error("open logs failed", "error", err, "path", logPath)
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
				resp.Payload = map[string]string{"path": logPath}
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
			break
		}
	}
}

func storageContext() context.Context {
	return context.Background()
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
		total += parseSpeedBytes(download.Speed)
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

func parseSpeedBytes(speed string) int64 {
	parts := strings.Fields(strings.TrimSpace(speed))
	if len(parts) != 2 || !strings.HasSuffix(parts[1], "/s") {
		return 0
	}

	value, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0
	}

	unit := strings.TrimSuffix(strings.ToUpper(parts[1]), "/S")
	multipliers := map[string]float64{
		"B":  1,
		"KB": 1024,
		"MB": 1024 * 1024,
		"GB": 1024 * 1024 * 1024,
		"TB": 1024 * 1024 * 1024 * 1024,
	}

	return int64(value * multipliers[unit])
}
