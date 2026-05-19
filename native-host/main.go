package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	// Redirect logs to stderr
	fmt.Fprintln(os.Stderr, "TuyulDM Native Host Started")

	dataDir, err := DataDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Data dir error:", err)
		return
	}
	fmt.Fprintln(os.Stderr, "Data dir:", dataDir)

	storage, err := NewStorage(filepath.Join(dataDir, "tuyuldm.db"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Storage error:", err)
		return
	}
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
		fmt.Fprintln(os.Stderr, "Failed to pause stale downloads:", err)
	}
	scheduler := newDownloadScheduler(storage, engine)
	if err := scheduler.Reconcile(time.Now()); err != nil {
		fmt.Fprintln(os.Stderr, "Initial scheduler reconcile failed:", err)
	}
	schedulerCtx, cancelScheduler := context.WithCancel(context.Background())
	defer cancelScheduler()
	go scheduler.Start(schedulerCtx)

	for {
		payload, err := ReadMessage(os.Stdin)
		if err != nil {
			if err != io.EOF {
				fmt.Fprintln(os.Stderr, "Read error:", err)
			}
			break
		}

		var req Request
		if err := json.Unmarshal(payload, &req); err != nil {
			fmt.Fprintln(os.Stderr, "Unmarshal error:", err)
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
			json.Unmarshal(req.Params, &params)
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
			json.Unmarshal(req.Params, &params)
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
			json.Unmarshal(req.Params, &params)
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
			json.Unmarshal(req.Params, &params)
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
			json.Unmarshal(req.Params, &params)
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

			downloadsDir, err := DownloadsDir()
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
			if err := json.Unmarshal(req.Params, &params); err != nil {
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
			if err := json.Unmarshal(req.Params, &params); err != nil {
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
		case "download.getProgress":
			var params struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
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
		}

		out, _ := json.Marshal(resp)
		if err := WriteMessage(os.Stdout, out); err != nil {
			fmt.Fprintln(os.Stderr, "Write error:", err)
			break
		}
	}
}

func storageContext() context.Context {
	return context.Background()
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
