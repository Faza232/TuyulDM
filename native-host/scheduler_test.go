package main

import (
	"context"
	"testing"
	"time"
)

type fakeSchedulerController struct {
	paused  []string
	resumed []string
}

func (controller *fakeSchedulerController) pauseSystem(_ context.Context, id string) error {
	controller.paused = append(controller.paused, id)
	return nil
}

func (controller *fakeSchedulerController) Resume(_ context.Context, id string) error {
	controller.resumed = append(controller.resumed, id)
	return nil
}

func TestDownloadScheduleAllowsOvernightWindow(t *testing.T) {
	schedule := &DownloadSchedule{StartHour: 22, EndHour: 2, Days: []int{int(time.Monday)}}

	if !downloadScheduleAllows(schedule, time.Date(2026, time.May, 18, 23, 0, 0, 0, time.UTC)) {
		t.Fatal("expected Monday 23:00 to be inside overnight window")
	}

	if !downloadScheduleAllows(schedule, time.Date(2026, time.May, 19, 1, 0, 0, 0, time.UTC)) {
		t.Fatal("expected Tuesday 01:00 to still be inside Monday overnight window")
	}

	if downloadScheduleAllows(schedule, time.Date(2026, time.May, 19, 3, 0, 0, 0, time.UTC)) {
		t.Fatal("expected Tuesday 03:00 to be outside overnight window")
	}
}

func TestSchedulerReconcilePausesAndResumesBySchedule(t *testing.T) {
	storage := newTestStorage(t)
	controller := &fakeSchedulerController{}
	scheduler := newDownloadScheduler(storage, controller)
	now := time.Date(2026, time.May, 19, 10, 0, 0, 0, time.UTC)

	for _, download := range []*DownloadState{
		{
			ID:            "auto-resume",
			Status:        "paused",
			Type:          "file",
			CreatedAt:     now,
			Segments:      []Segment{{Index: 0, Start: 0, End: -1}},
			WasUserPaused: false,
		},
		{
			ID:            "manual-pause",
			Status:        "paused",
			Type:          "file",
			CreatedAt:     now,
			Segments:      []Segment{{Index: 0, Start: 0, End: -1}},
			WasUserPaused: true,
		},
		{
			ID:        "scheduled-pause",
			Status:    "downloading",
			Type:      "file",
			CreatedAt: now,
			Segments:  []Segment{{Index: 0, Start: 0, End: -1}},
			Schedule: &DownloadSchedule{
				StartHour: 2,
				EndHour:   6,
				Days:      []int{int(now.Weekday())},
			},
		},
	} {
		if err := storage.SaveDownload(download); err != nil {
			t.Fatalf("SaveDownload returned error: %v", err)
		}
	}

	if err := scheduler.Reconcile(now); err != nil {
		t.Fatalf("Reconcile returned error: %v", err)
	}

	if len(controller.resumed) != 1 || controller.resumed[0] != "auto-resume" {
		t.Fatalf("expected auto-resume to resume, got %v", controller.resumed)
	}

	if len(controller.paused) != 1 || controller.paused[0] != "scheduled-pause" {
		t.Fatalf("expected scheduled-pause to pause, got %v", controller.paused)
	}
}
