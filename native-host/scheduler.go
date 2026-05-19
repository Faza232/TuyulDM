package main

import (
	"context"
	"time"
)

type schedulerController interface {
	pauseSystem(id string) error
	Resume(id string) error
}

type downloadScheduler struct {
	storage    *Storage
	controller schedulerController
}

func newDownloadScheduler(storage *Storage, controller schedulerController) *downloadScheduler {
	return &downloadScheduler{storage: storage, controller: controller}
}

func (scheduler *downloadScheduler) Start(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			_ = scheduler.Reconcile(now)
		}
	}
}

func (scheduler *downloadScheduler) Reconcile(now time.Time) error {
	downloads, err := scheduler.storage.ListDownloads()
	if err != nil {
		return err
	}

	for i := range downloads {
		if err := scheduler.reconcileDownload(&downloads[i], now); err != nil {
			return err
		}
	}

	return nil
}

func (scheduler *downloadScheduler) reconcileDownload(download *DownloadState, now time.Time) error {
	if download.Status == "finished" || download.Status == "error" {
		return nil
	}

	if !downloadScheduleAllows(download.Schedule, now) {
		switch download.Status {
		case "downloading", "muxing", "queued":
			return scheduler.controller.pauseSystem(download.ID)
		}
		return nil
	}

	if download.Status == "paused" && !download.WasUserPaused {
		if err := scheduler.controller.Resume(download.ID); err != nil && err.Error() != "already active" {
			return err
		}
	}

	return nil
}

func downloadScheduleAllows(schedule *DownloadSchedule, now time.Time) bool {
	if schedule == nil {
		return true
	}

	startHour := normalizeScheduleHour(schedule.StartHour)
	endHour := normalizeScheduleHour(schedule.EndHour)
	currentHour := now.Hour()

	if startHour == endHour {
		return scheduleMatchesDay(schedule.Days, int(now.Weekday()))
	}

	if startHour < endHour {
		return scheduleMatchesDay(schedule.Days, int(now.Weekday())) && currentHour >= startHour && currentHour < endHour
	}

	if currentHour >= startHour {
		return scheduleMatchesDay(schedule.Days, int(now.Weekday()))
	}

	if currentHour < endHour {
		return scheduleMatchesDay(schedule.Days, previousScheduleDay(now.Weekday()))
	}

	return false
}

func normalizeScheduleHour(hour int) int {
	if hour < 0 {
		return 0
	}
	if hour > 23 {
		return 23
	}
	return hour
}

func scheduleMatchesDay(days []int, weekday int) bool {
	if len(days) == 0 {
		return true
	}

	for _, day := range days {
		if normalizeScheduleDay(day) == weekday {
			return true
		}
	}

	return false
}

func normalizeScheduleDay(day int) int {
	if day < 0 {
		return 0
	}
	if day > 6 {
		return 6
	}
	return day
}

func previousScheduleDay(day time.Weekday) int {
	if day == time.Sunday {
		return int(time.Saturday)
	}
	return int(day - 1)
}

func cloneDownloadSchedule(schedule *DownloadSchedule) *DownloadSchedule {
	if schedule == nil {
		return nil
	}

	clone := *schedule
	clone.Days = append([]int(nil), schedule.Days...)
	return &clone
}
