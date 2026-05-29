import type { DetectedMediaEntry, ExtractionStrategy, VariantInfo } from '../../extension/src/shared/media_classify';

export type { ExtractionStrategy, VariantInfo, DetectedMediaEntry };

export type DownloadStatus =
  | 'downloading'
  | 'paused'
  | 'finished'
  | 'queued'
  | 'error'
  | 'muxing'
  | 'awaiting_url_refresh';

export interface DownloadItem {
  id: number | string;
  name?: string;
  filename?: string;
  url?: string;
  output_path?: string;
  size?: string;
  total_size?: number;
  progress: number;
  speed: string;
  speed_bytes_per_second?: number;
  status: DownloadStatus;
  type?: string;
  error?: string;
  error_code?: string;
  last_attempt_at?: string;
  extraction_strategy?: ExtractionStrategy | string;
  site_key?: string;
  offer_title?: string;
  offer_debug?: Record<string, string>;
  track_count?: number;
  assembly_stage?: string;
  plan?: { strategy?: string; final_container?: string; steps?: { kind: string }[] } | null;
  tracks?: Array<{ id?: string; kind?: string; codec?: string; bitrate?: number; width?: number; height?: number; container?: string }>;
}

export type DetectedStreamItem = DetectedMediaEntry;

export interface InterceptionSettings {
  enabled: boolean;
  extensions: string[];
  minFileSizeMB: number;
  allowDomains: string[];
  blockDomains: string[];
  autoShowDetectedStreams: boolean;
  scheduleEnabled: boolean;
  scheduleStartHour: number;
  scheduleEndHour: number;
  scheduleDays: number[];
}

export interface HostSettings {
  maxConcurrentDownloads: number;
  globalThrottleBytesPerSecond: number;
  perDownloadThrottleBytesPerSecond: number;
  downloadDir: string;
  logLevel: string;
}

export interface PermissionStatus {
  currentOrigin: string;
  currentOriginPattern: string;
  currentOriginGranted: boolean;
  canRequestCurrentOrigin: boolean;
  hasAllUrlsPermission: boolean;
  grantedOrigins: string[];
  shouldShowOnboarding: boolean;
}

export interface HostStatus {
  connected: boolean;
  protocolVersion: string;
  lastError: string | null;
}

export interface HostStats {
  globalSpeedBytesPerSecond: number;
  freeSpaceBytes: number;
  activeDownloads: number;
}

export interface DownloadSchedulePayload {
  start_hour: number;
  end_hour: number;
  days: number[];
}

export interface RefreshUrlResponse {
  download?: DownloadItem;
  error?: string;
  code?: string;
  details?: Record<string, unknown> | null;
}

// UI-only preferences (not owned by the native host).
export interface UiPreferences {
  density: 'cozy' | 'compact';
  accent: string;
  openOnFinish: boolean;
  segments: number;
}

// Best-effort external resolver / adapter settings. The background does not yet
// persist these (no IPC handler), so they live client-side until host support
// lands. See BUILD_PLAN_5 Phase AC / Phase S.
export interface AdapterSettings {
  resolverEnabled: boolean;
  binaryPath: string;
  resolveTimeoutMs: number;
  debugLogging: boolean;
}
