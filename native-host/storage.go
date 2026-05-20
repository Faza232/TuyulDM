package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"go.etcd.io/bbolt"
)

type DownloadState struct {
	ID                string            `json:"id"`
	URL               string            `json:"url"`
	Filename          string            `json:"filename"`
	OutputPath        string            `json:"output_path,omitempty"`
	TotalSize         int64             `json:"total_size"`
	Status            string            `json:"status"`
	Progress          float64           `json:"progress"`
	Speed             string            `json:"speed"`
	Type              string            `json:"type"` // "file" or "video"
	Error             string            `json:"error,omitempty"`
	ErrorCode         string            `json:"error_code,omitempty"`
	LastAttemptAt     time.Time         `json:"last_attempt_at,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	Headers           map[string]string `json:"headers,omitempty"`
	Cookies           []RequestCookie   `json:"cookies,omitempty"`
	ContentMD5        string            `json:"content_md5,omitempty"`
	Digest            string            `json:"digest,omitempty"`
	ManifestType      string            `json:"manifest_type,omitempty"`
	SelectedVariantID string            `json:"selected_variant_id,omitempty"`
	VideoContainer    string            `json:"video_container,omitempty"`
	Parallelism       int               `json:"parallelism,omitempty"`
	Variants          []VideoVariant    `json:"variants,omitempty"`
	Segments          []Segment         `json:"segments"`
	Schedule          *DownloadSchedule `json:"schedule,omitempty"`
	WasUserPaused     bool              `json:"was_user_paused,omitempty"`
}

type DownloadSchedule struct {
	StartHour int   `json:"start_hour"`
	EndHour   int   `json:"end_hour"`
	Days      []int `json:"days,omitempty"`
}

type VideoVariant struct {
	ID         string `json:"id"`
	Name       string `json:"name,omitempty"`
	Bandwidth  int64  `json:"bandwidth,omitempty"`
	Resolution string `json:"resolution,omitempty"`
	Codecs     string `json:"codecs,omitempty"`
	URL        string `json:"url,omitempty"`
}

type RequestCookie struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Domain string `json:"domain,omitempty"`
	Path   string `json:"path,omitempty"`
}

func (c RequestCookie) normalizedPath() string {
	if c.Path == "" {
		return "/"
	}
	return c.Path
}

func (c RequestCookie) toHTTPCookie() *http.Cookie {
	return &http.Cookie{
		Name:   c.Name,
		Value:  c.Value,
		Domain: c.Domain,
		Path:   c.normalizedPath(),
	}
}

type Segment struct {
	Index     int     `json:"index"`
	Start     int64   `json:"start"`
	End       int64   `json:"end"`
	Current   int64   `json:"current"`
	Completed bool    `json:"completed"`
	URL       string  `json:"url,omitempty"`
	Track     string  `json:"track,omitempty"`
	Duration  float64 `json:"duration,omitempty"`
}

type Storage struct {
	db *bbolt.DB
}

const (
	bucketName             = "Downloads"
	hostSettingsBucketName = "HostSettings"
)

func NewStorage(path string) (*Storage, error) {
	db, err := bbolt.Open(path, 0600, &bbolt.Options{Timeout: 1 * time.Second})
	if err != nil {
		return nil, err
	}

	err = db.Update(func(tx *bbolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(bucketName))
		if err != nil {
			return err
		}
		_, err = tx.CreateBucketIfNotExists([]byte(hostSettingsBucketName))
		return err
	})
	if err != nil {
		return nil, err
	}

	return &Storage{db: db}, nil
}

func (s *Storage) SaveDownload(d *DownloadState) error {
	return s.db.Update(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		data, err := json.Marshal(d)
		if err != nil {
			return err
		}
		return b.Put([]byte(d.ID), data)
	})
}

func (s *Storage) DeleteDownload(id string) error {
	return s.db.Update(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		if b.Get([]byte(id)) == nil {
			return fmt.Errorf("download not found")
		}
		return b.Delete([]byte(id))
	})
}

func (s *Storage) GetDownload(id string) (*DownloadState, error) {
	var d DownloadState
	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		v := b.Get([]byte(id))
		if v == nil {
			return fmt.Errorf("download not found")
		}
		return json.Unmarshal(v, &d)
	})
	return &d, err
}

func (s *Storage) ListDownloads() ([]DownloadState, error) {
	var list []DownloadState
	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		return b.ForEach(func(k, v []byte) error {
			var d DownloadState
			if err := json.Unmarshal(v, &d); err != nil {
				slog.Warn("skip corrupted download record", "download_id", string(k), "error", err)
				return nil
			}
			list = append(list, d)
			return nil
		})
	})
	return list, err
}

func (s *Storage) PauseActiveDownloads() error {
	return s.db.Update(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		return b.ForEach(func(k, v []byte) error {
			var d DownloadState
			if err := json.Unmarshal(v, &d); err != nil {
				slog.Error("decode persisted download failed", "download_id", string(k), "error", err)
				return err
			}

			if d.Status != "downloading" && d.Status != "muxing" {
				return nil
			}

			d.Status = "paused"
			d.Speed = "0 B/s"
			d.WasUserPaused = false
			data, err := json.Marshal(&d)
			if err != nil {
				return err
			}
			return b.Put(k, data)
		})
	})
}

func (s *Storage) GetHostSettings() (HostSettings, error) {
	settings := defaultHostSettings()
	err := s.db.View(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket([]byte(hostSettingsBucketName))
		if bucket == nil {
			return nil
		}
		value := bucket.Get([]byte("settings"))
		if value == nil {
			return nil
		}
		return json.Unmarshal(value, &settings)
	})
	if err != nil {
		return HostSettings{}, err
	}
	hydrated, changed, err := hydrateHostSettings(settings)
	if err != nil {
		return HostSettings{}, err
	}
	if changed {
		if saveErr := s.SaveHostSettings(hydrated); saveErr != nil {
			return HostSettings{}, saveErr
		}
	}
	return hydrated, nil
}

func (s *Storage) SaveHostSettings(settings HostSettings) error {
	normalized := normalizeHostSettings(settings)
	return s.db.Update(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket([]byte(hostSettingsBucketName))
		data, err := json.Marshal(&normalized)
		if err != nil {
			return err
		}
		return bucket.Put([]byte("settings"), data)
	})
}
