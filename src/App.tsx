/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Github,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Video,
  Monitor,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { DetectedMediaEntry, ExtractionStrategy, VariantInfo } from '../extension/src/shared/media_classify';
import { STRATEGY_LABELS, strategyAssemblyKind } from '../extension/src/shared/media_classify';

type AppSurface = 'dashboard' | 'popup' | 'options';

interface AppProps {
  surface?: AppSurface;
}

interface DownloadItem {
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
  status: 'downloading' | 'paused' | 'finished' | 'queued' | 'error' | 'muxing' | 'awaiting_url_refresh';
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
}

const PROTECTED_REASON_LABELS: Record<string, string> = {
  drm_detected: 'Encrypted (DRM)',
  encrypted_hls: 'Encrypted HLS stream',
  unsupported_site_strategy: 'Site strategy not supported',
  site_adapter_failed: 'Site adapter failed',
};

function describeProtectedReason(code?: string) {
  if (!code) {
    return 'Refused';
  }
  return PROTECTED_REASON_LABELS[code] || code;
}

function buildSafeDebugSnapshot(download: DownloadItem) {
  return {
    id: download.id,
    name: download.name || download.filename,
    extraction_strategy: download.extraction_strategy,
    site_key: download.site_key,
    track_count: download.track_count,
    assembly_stage: download.assembly_stage,
    plan: download.plan,
    offer_debug: download.offer_debug,
    status: download.status,
    error_code: download.error_code,
  };
}

interface RefreshUrlResponse {
	download?: DownloadItem;
	error?: string;
	code?: string;
	details?: Record<string, unknown> | null;
}

interface ActiveTabUrlResponse {
	url?: string;
	error?: string;
}

interface RefreshUrlDialogState {
	id: number | string;
	label: string;
	currentUrl: string;
}

interface RefreshUrlMismatchState {
	code?: string;
	message: string;
	details?: Record<string, unknown> | null;
}

interface RefreshUrlContextMenuState {
	id: number | string;
	x: number;
	y: number;
}

interface InterceptionSettings {
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

type DetectedStreamItem = DetectedMediaEntry;

interface PermissionStatus {
  currentOrigin: string;
  currentOriginPattern: string;
  currentOriginGranted: boolean;
  canRequestCurrentOrigin: boolean;
  hasAllUrlsPermission: boolean;
  grantedOrigins: string[];
  shouldShowOnboarding: boolean;
}

interface HostStatus {
  connected: boolean;
  protocolVersion: string;
  lastError: string | null;
}

interface HostStats {
  globalSpeedBytesPerSecond: number;
  freeSpaceBytes: number;
  activeDownloads: number;
}

interface HostSettings {
  maxConcurrentDownloads: number;
  globalThrottleBytesPerSecond: number;
  perDownloadThrottleBytesPerSecond: number;
  downloadDir: string;
  logLevel: string;
}

interface DownloadSchedulePayload {
  start_hour: number;
  end_hour: number;
  days: number[];
}

const DEFAULT_INTERCEPTION_SETTINGS: InterceptionSettings = {
  enabled: true,
  extensions: ['zip', 'iso', 'mp4', 'mkv', '7z', 'tar', 'gz'],
  minFileSizeMB: 50,
  allowDomains: [],
  blockDomains: [],
  autoShowDetectedStreams: false,
  scheduleEnabled: false,
  scheduleStartHour: 2,
  scheduleEndHour: 6,
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
};

const DEFAULT_HOST_STATUS: HostStatus = {
  connected: false,
  protocolVersion: 'IPC v1',
  lastError: null,
};

const DEFAULT_PERMISSION_STATUS: PermissionStatus = {
  currentOrigin: '',
  currentOriginPattern: '',
  currentOriginGranted: false,
  canRequestCurrentOrigin: false,
  hasAllUrlsPermission: false,
  grantedOrigins: [],
  shouldShowOnboarding: false,
};

const DEFAULT_HOST_STATS: HostStats = {
  globalSpeedBytesPerSecond: 0,
  freeSpaceBytes: 0,
  activeDownloads: 0,
};

const DEFAULT_HOST_SETTINGS: HostSettings = {
  maxConcurrentDownloads: 3,
  globalThrottleBytesPerSecond: 0,
  perDownloadThrottleBytesPerSecond: 0,
  downloadDir: '',
  logLevel: 'info',
};

const HOST_SETTINGS_STORAGE_KEY = 'tuyuldm_host_settings';
const REPOSITORY_URL = 'https://github.com/husainfaza/TuyulDM';
const WEEKDAY_OPTIONS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
] as const;
const DEFAULT_SCHEDULE_DAYS = WEEKDAY_OPTIONS.map((option) => option.value);

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeExtensionRule(value: string) {
  return value.trim().toLowerCase().replace(/^\./, '');
}

function normalizeDomainRule(value: string) {
  return value.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
}

function normalizeScheduleDay(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(6, Math.max(0, Math.round(value)));
}

function normalizeScheduleDays(values: unknown) {
  if (!Array.isArray(values)) {
    return [...DEFAULT_SCHEDULE_DAYS];
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeScheduleDay(Number(value)))
        .filter((value) => Number.isFinite(value)),
    ),
  ).sort((left, right) => left - right);

  if (normalized.length === 0) {
    return [...DEFAULT_SCHEDULE_DAYS];
  }

  return normalized;
}

function toggleScheduleDayValue(days: number[], day: number) {
  if (days.includes(day)) {
    if (days.length === 1) {
      return days;
    }
    return days.filter((value) => value !== day);
  }
  return [...days, day].sort((left, right) => left - right);
}

function formatScheduleHour(hour: number) {
  return `${normalizeScheduleHour(hour).toString().padStart(2, '0')}:00`;
}

function formatScheduleSummary(enabled: boolean, startHour: number, endHour: number, days: number[]) {
  if (!enabled) {
    return 'disabled';
  }

  const dayLabel = days.length === WEEKDAY_OPTIONS.length ? 'every day' : `${days.length} days`;
  return `${formatScheduleHour(startHour)}-${formatScheduleHour(endHour)} · ${dayLabel}`;
}

function parseSettingsList(value: string, normalize: (value: string) => string) {
  return uniqueStrings(
    value
      .split(/[\n,]/)
      .map(normalize)
      .filter(Boolean),
  );
}

function formatExtensionRules(values: string[]) {
  return values.map((value) => `.${value}`).join('\n');
}

function formatDomainRules(values: string[]) {
  return values.join('\n');
}

function normalizeInterceptionSettings(settings: Partial<InterceptionSettings>): InterceptionSettings {
  const minFileSizeMB = Number.isFinite(Number(settings.minFileSizeMB))
    ? Math.max(0, Number(settings.minFileSizeMB))
    : DEFAULT_INTERCEPTION_SETTINGS.minFileSizeMB;

  return {
    enabled: typeof settings.enabled === 'boolean' ? settings.enabled : DEFAULT_INTERCEPTION_SETTINGS.enabled,
    extensions: uniqueStrings((settings.extensions ?? DEFAULT_INTERCEPTION_SETTINGS.extensions).map(normalizeExtensionRule)),
    minFileSizeMB,
    allowDomains: uniqueStrings((settings.allowDomains ?? DEFAULT_INTERCEPTION_SETTINGS.allowDomains).map(normalizeDomainRule)),
    blockDomains: uniqueStrings((settings.blockDomains ?? DEFAULT_INTERCEPTION_SETTINGS.blockDomains).map(normalizeDomainRule)),
    autoShowDetectedStreams: typeof settings.autoShowDetectedStreams === 'boolean'
      ? settings.autoShowDetectedStreams
      : DEFAULT_INTERCEPTION_SETTINGS.autoShowDetectedStreams,
    scheduleEnabled: typeof settings.scheduleEnabled === 'boolean' ? settings.scheduleEnabled : DEFAULT_INTERCEPTION_SETTINGS.scheduleEnabled,
    scheduleStartHour: normalizeScheduleHour(Number(settings.scheduleStartHour ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleStartHour)),
    scheduleEndHour: normalizeScheduleHour(Number(settings.scheduleEndHour ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleEndHour)),
    scheduleDays: normalizeScheduleDays(settings.scheduleDays ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleDays),
  };
}

function normalizeHostStatus(status: Partial<HostStatus> | undefined): HostStatus {
  return {
    connected: typeof status?.connected === 'boolean' ? status.connected : DEFAULT_HOST_STATUS.connected,
    protocolVersion: status?.protocolVersion || DEFAULT_HOST_STATUS.protocolVersion,
    lastError: status?.lastError ?? DEFAULT_HOST_STATUS.lastError,
  };
}

function normalizeGrantedOrigins(origins: unknown) {
  if (!Array.isArray(origins)) {
    return [] as string[];
  }

  return Array.from(new Set(origins.map((origin) => String(origin || '').trim()).filter(Boolean))).sort((left, right) => {
    if (left === '<all_urls>') {
      return -1;
    }
    if (right === '<all_urls>') {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function normalizePermissionStatus(status: Partial<PermissionStatus> | undefined): PermissionStatus {
  return {
    currentOrigin: typeof status?.currentOrigin === 'string' ? status.currentOrigin : DEFAULT_PERMISSION_STATUS.currentOrigin,
    currentOriginPattern: typeof status?.currentOriginPattern === 'string' ? status.currentOriginPattern : DEFAULT_PERMISSION_STATUS.currentOriginPattern,
    currentOriginGranted: typeof status?.currentOriginGranted === 'boolean' ? status.currentOriginGranted : DEFAULT_PERMISSION_STATUS.currentOriginGranted,
    canRequestCurrentOrigin: typeof status?.canRequestCurrentOrigin === 'boolean' ? status.canRequestCurrentOrigin : DEFAULT_PERMISSION_STATUS.canRequestCurrentOrigin,
    hasAllUrlsPermission: typeof status?.hasAllUrlsPermission === 'boolean' ? status.hasAllUrlsPermission : DEFAULT_PERMISSION_STATUS.hasAllUrlsPermission,
    grantedOrigins: normalizeGrantedOrigins(status?.grantedOrigins),
    shouldShowOnboarding: typeof status?.shouldShowOnboarding === 'boolean' ? status.shouldShowOnboarding : DEFAULT_PERMISSION_STATUS.shouldShowOnboarding,
  };
}

function normalizeHostStats(stats: Partial<HostStats> | undefined): HostStats {
  return {
    globalSpeedBytesPerSecond: Number.isFinite(Number(stats?.globalSpeedBytesPerSecond))
      ? Number(stats?.globalSpeedBytesPerSecond)
      : DEFAULT_HOST_STATS.globalSpeedBytesPerSecond,
    freeSpaceBytes: Number.isFinite(Number(stats?.freeSpaceBytes)) ? Number(stats?.freeSpaceBytes) : DEFAULT_HOST_STATS.freeSpaceBytes,
    activeDownloads: Number.isFinite(Number(stats?.activeDownloads)) ? Number(stats?.activeDownloads) : DEFAULT_HOST_STATS.activeDownloads,
  };
}

function normalizeLogLevel(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : DEFAULT_HOST_SETTINGS.logLevel;
  return ['debug', 'info', 'warn', 'error'].includes(normalized) ? normalized : DEFAULT_HOST_SETTINGS.logLevel;
}

function normalizeHostSettings(settings: Partial<HostSettings> | undefined): HostSettings {
  return {
    maxConcurrentDownloads: Number.isFinite(Number(settings?.maxConcurrentDownloads))
      ? Math.min(32, Math.max(1, Number(settings?.maxConcurrentDownloads)))
      : DEFAULT_HOST_SETTINGS.maxConcurrentDownloads,
    globalThrottleBytesPerSecond: Number.isFinite(Number(settings?.globalThrottleBytesPerSecond))
      ? Math.max(0, Number(settings?.globalThrottleBytesPerSecond))
      : DEFAULT_HOST_SETTINGS.globalThrottleBytesPerSecond,
    perDownloadThrottleBytesPerSecond: Number.isFinite(Number(settings?.perDownloadThrottleBytesPerSecond))
      ? Math.max(0, Number(settings?.perDownloadThrottleBytesPerSecond))
      : DEFAULT_HOST_SETTINGS.perDownloadThrottleBytesPerSecond,
    downloadDir: typeof settings?.downloadDir === 'string' ? settings.downloadDir.trim() : DEFAULT_HOST_SETTINGS.downloadDir,
    logLevel: normalizeLogLevel(settings?.logLevel),
  };
}

function bytesPerSecondFromKilobytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 1024);
}

function kilobytesPerSecondFromBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value / 1024);
}

function normalizeScheduleHour(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(23, Math.max(0, Math.round(value)));
}

function getChromeRuntime() {
  const runtime = (window as any).browser?.runtime ?? (window as any).chrome?.runtime;
  return runtime?.sendMessage ? runtime : null;
}

function isExtensionRuntimeAvailable() {
  return !!getChromeRuntime();
}

async function sendExtensionMessage<T = any>(message: Record<string, unknown>): Promise<T | undefined> {
  const runtime = getChromeRuntime();
  if (!runtime) {
    return undefined;
  }

  return runtime.sendMessage(message);
}

function formatSize(bytes: number | string) {
  if (typeof bytes === 'string') {
    return bytes;
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond: number) {
  return `${formatSize(bytesPerSecond)}/s`;
}

function formatDownloadSpeed(download: DownloadItem) {
  if (download.status === 'muxing') {
    return 'Muxing';
  }
  if (download.status === 'awaiting_url_refresh' || download.error_code === 'url_expired') {
    return 'Awaiting refresh';
  }

  const rawSpeed = Number(download.speed_bytes_per_second ?? 0);
  if (Number.isFinite(rawSpeed) && rawSpeed > 0) {
    return formatSpeed(rawSpeed);
  }

  return download.speed || '0 B/s';
}

function formatAttemptTimestamp(value: string | undefined) {
  if (!value) {
    return 'unknown';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return timestamp.toLocaleString();
}

function getDownloadLabel(download: DownloadItem) {
  return download.name || download.filename || `Download ${download.id}`;
}

function downloadNeedsUrlRefresh(download: DownloadItem) {
  return download.status === 'awaiting_url_refresh' || download.error_code === 'url_expired';
}

function canForceRefreshWithoutValidators(code: string | undefined) {
  return code === 'validators_missing';
}

function canRestartRefreshFromScratch(code: string | undefined) {
  return ['size_mismatch', 'etag_mismatch', 'last_modified_mismatch', 'accept_ranges_required'].includes(code || '');
}

function formatRefreshIssueTitle(code: string | undefined) {
  switch (code) {
    case 'size_mismatch':
      return 'Fresh URL points to different size';
    case 'etag_mismatch':
      return 'Fresh URL points to different ETag';
    case 'last_modified_mismatch':
      return 'Fresh URL points to different last-modified value';
    case 'validators_missing':
      return 'Fresh URL dropped validators';
    case 'accept_ranges_required':
      return 'Fresh URL cannot resume with ranges';
    default:
      return 'Refresh needs review';
  }
}

function formatRefreshDetailLabel(key: string) {
  switch (key) {
    case 'expectedTotalSize':
      return 'Expected Size';
    case 'actualTotalSize':
      return 'New Size';
    case 'oldETag':
      return 'Old ETag';
    case 'newETag':
      return 'New ETag';
    case 'oldLastModified':
      return 'Old Last-Modified';
    case 'newLastModified':
      return 'New Last-Modified';
    case 'acceptRanges':
      return 'Accept-Ranges';
    default:
      return key;
  }
}

function formatRefreshDetailValue(key: string, value: unknown) {
  if (typeof value === 'number' && key.toLowerCase().includes('size')) {
    return formatSize(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (value == null || value === '') {
    return 'unknown';
  }
  return String(value);
}

function formatDetectedTimestamp(value: number | undefined) {
  if (!Number.isFinite(value) || !value) {
    return 'just now';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'just now';
  }
  return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function normalizeDetectedStreamItem(item: Partial<DetectedStreamItem> | undefined): DetectedStreamItem {
  return {
    id: typeof item?.id === 'string' ? item.id : `${item?.kind || 'unknown'}:${item?.url || ''}`,
    url: typeof item?.url === 'string' ? item.url : '',
    kind: typeof item?.kind === 'string' ? item.kind : 'unknown',
    label: typeof item?.label === 'string' ? item.label : 'Detected media',
    pageUrl: typeof item?.pageUrl === 'string' ? item.pageUrl : '',
    detectedAt: Number.isFinite(Number(item?.detectedAt)) ? Number(item?.detectedAt) : Date.now(),
    source: item?.source === 'network' || item?.source === 'page' || item?.source === 'scan' ? item.source : 'page',
    sizeHint: Number.isFinite(Number(item?.sizeHint)) ? Number(item?.sizeHint) : undefined,
    manifestType: item?.manifestType === 'HLS' || item?.manifestType === 'DASH' ? item.manifestType : undefined,
    qualities: Array.isArray(item?.qualities)
      ? item.qualities
        .map((variant) => ({
          id: String(variant?.id || '').trim(),
          name: typeof variant?.name === 'string' ? variant.name : '',
          bandwidth: Number.isFinite(Number(variant?.bandwidth)) ? Number(variant?.bandwidth) : undefined,
          resolution: typeof variant?.resolution === 'string' ? variant.resolution : '',
          codecs: typeof variant?.codecs === 'string' ? variant.codecs : '',
          url: typeof variant?.url === 'string' ? variant.url : '',
        }))
        .filter((variant) => !!variant.id)
      : undefined,
    selectedVariantId: typeof item?.selectedVariantId === 'string' ? item.selectedVariantId : undefined,
    posterUrl: typeof item?.posterUrl === 'string' ? item.posterUrl : undefined,
    protected: item?.protected === true,
    protectedReason: typeof item?.protectedReason === 'string' ? item.protectedReason : undefined,
  };
}

function normalizeDetectedStreamList(streams: unknown) {
  if (!Array.isArray(streams)) {
    return [] as DetectedStreamItem[];
  }
  return streams.map((stream) => normalizeDetectedStreamItem(stream));
}

function formatVariantLabel(variant: VariantInfo | undefined) {
  if (!variant) {
    return 'Default quality';
  }

  const parts = [
    variant.name,
    variant.resolution,
    Number.isFinite(variant.bandwidth) && variant.bandwidth
      ? `${Math.round(variant.bandwidth / 1000)} kbps`
      : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'Default quality';
}

function formatDetectedMediaSource(source: DetectedStreamItem['source']) {
  if (source === 'network') {
    return 'network';
  }
  if (source === 'scan') {
    return 'scan';
  }
  return 'page';
}

function formatGrantedOrigin(origin: string) {
  return origin === '<all_urls>' ? 'All sites (<all_urls>)' : origin;
}

function isValidDownloadUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getDownloadParentDirectory(outputPath: string | undefined) {
  if (!outputPath) {
    return '';
  }

  const normalized = outputPath.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (separatorIndex <= 0) {
    return normalized;
  }
  return normalized.slice(0, separatorIndex);
}

export default function App({ surface = 'dashboard' }: AppProps) {
  const isOptionsSurface = surface === 'options';
  const isPopupSurface = surface === 'popup';
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'finished' | 'grabber'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [segmentsCount, setSegmentsCount] = useState(() => {
    const saved = localStorage.getItem('tuyuldm_segments');
    return saved ? parseInt(saved, 10) : 8;
  });
  const [interceptionSettings, setInterceptionSettings] = useState<InterceptionSettings>(DEFAULT_INTERCEPTION_SETTINGS);
  const [extensionRulesInput, setExtensionRulesInput] = useState(() => formatExtensionRules(DEFAULT_INTERCEPTION_SETTINGS.extensions));
  const [allowDomainsInput, setAllowDomainsInput] = useState(() => formatDomainRules(DEFAULT_INTERCEPTION_SETTINGS.allowDomains));
  const [blockDomainsInput, setBlockDomainsInput] = useState(() => formatDomainRules(DEFAULT_INTERCEPTION_SETTINGS.blockDomains));
  const [hostStatus, setHostStatus] = useState<HostStatus>(DEFAULT_HOST_STATUS);
  const [hostStats, setHostStats] = useState<HostStats>(DEFAULT_HOST_STATS);
  const [hostSettings, setHostSettings] = useState<HostSettings>(DEFAULT_HOST_SETTINGS);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>(DEFAULT_PERMISSION_STATUS);
  const [permissionNotice, setPermissionNotice] = useState<string | null>(null);
  const [detectedStreams, setDetectedStreams] = useState<DetectedStreamItem[]>([]);
  const [selectedGrabberVariants, setSelectedGrabberVariants] = useState<Record<string, string>>({});
  const [grabberNotice, setGrabberNotice] = useState<string | null>(null);
  const [isScanningPage, setIsScanningPage] = useState(false);
  const [grabberBusyUrl, setGrabberBusyUrl] = useState<string | null>(null);
  const [downloadDirInput, setDownloadDirInput] = useState(DEFAULT_HOST_SETTINGS.downloadDir);
  const [downloadDirError, setDownloadDirError] = useState<string | null>(null);
  // TODO: extend single-item removal flow to multi-select actions.
  const [removalTarget, setRemovalTarget] = useState<{ id: number | string; status: DownloadItem['status'] } | null>(null);
	const [refreshUrlDialog, setRefreshUrlDialog] = useState<RefreshUrlDialogState | null>(null);
	const [refreshUrlInput, setRefreshUrlInput] = useState('');
	const [refreshUrlError, setRefreshUrlError] = useState<string | null>(null);
	const [refreshUrlMismatch, setRefreshUrlMismatch] = useState<RefreshUrlMismatchState | null>(null);
	const [isRefreshingUrl, setIsRefreshingUrl] = useState(false);
	const [isLoadingCurrentTabUrl, setIsLoadingCurrentTabUrl] = useState(false);
	const [refreshContextMenu, setRefreshContextMenu] = useState<RefreshUrlContextMenuState | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleStartHour, setScheduleStartHour] = useState(2);
  const [scheduleEndHour, setScheduleEndHour] = useState(6);
  const [scheduleDays, setScheduleDays] = useState<number[]>(DEFAULT_SCHEDULE_DAYS);

  const syncInterceptionInputs = (settings: InterceptionSettings) => {
    setExtensionRulesInput(formatExtensionRules(settings.extensions));
    setAllowDomainsInput(formatDomainRules(settings.allowDomains));
    setBlockDomainsInput(formatDomainRules(settings.blockDomains));
  };

  const applyInterceptionSettings = (settings: Partial<InterceptionSettings>, syncInputs = false) => {
    const normalized = normalizeInterceptionSettings(settings);
    setInterceptionSettings(normalized);
    if (syncInputs) {
      syncInterceptionInputs(normalized);
    }
    return normalized;
  };

  const persistInterceptionSettings = async (settings: InterceptionSettings, syncInputs = false) => {
    const normalized = applyInterceptionSettings(settings, syncInputs);

    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ settings?: InterceptionSettings }>({
        type: 'UPDATE_INTERCEPTION_SETTINGS',
        settings: normalized,
      });

      if (response?.settings) {
        applyInterceptionSettings(response.settings, syncInputs);
      }
      return;
    }

    localStorage.setItem('tuyuldm_interception_settings', JSON.stringify(normalized));
  };

  const applyHostSettings = (settings: Partial<HostSettings>) => {
    const normalized = normalizeHostSettings(settings);
    setHostSettings(normalized);
    setDownloadDirInput(normalized.downloadDir);
    setDownloadDirError(null);
    return normalized;
  };

  const persistHostSettings = async (settings: Partial<HostSettings>) => {
    const normalized = applyHostSettings(settings);

    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ settings?: HostSettings }>({
        type: 'UPDATE_HOST_SETTINGS',
        settings: normalized,
      });

      if (response?.settings) {
        applyHostSettings(response.settings);
      }
      return;
    }

    localStorage.setItem(HOST_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  };

  const loadInterceptionSettings = async () => {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ settings?: InterceptionSettings }>({ type: 'GET_INTERCEPTION_SETTINGS' });
      if (response?.settings) {
        applyInterceptionSettings(response.settings, true);
      }
      return;
    }

    const saved = localStorage.getItem('tuyuldm_interception_settings');
    if (!saved) {
      return;
    }

    try {
      applyInterceptionSettings(JSON.parse(saved), true);
    } catch {
      localStorage.removeItem('tuyuldm_interception_settings');
    }
  };

  const loadHostSettings = async () => {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ settings?: HostSettings }>({ type: 'GET_HOST_SETTINGS' });
      if (response?.settings) {
        applyHostSettings(response.settings);
      }
      return;
    }

    const saved = localStorage.getItem(HOST_SETTINGS_STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      applyHostSettings(JSON.parse(saved));
    } catch {
      localStorage.removeItem(HOST_SETTINGS_STORAGE_KEY);
    }
  };

  const refreshPreviewData = async () => {
    const [downloadsResponse, statsResponse, hostStatusResponse] = await Promise.all([
      fetch('/api/downloads').then((response) => response.json()),
      fetch('/api/stats').then((response) => response.json()),
      fetch('/api/host-status').then((response) => response.json()),
    ]);

    setDownloads(downloadsResponse);
    setHostStats(normalizeHostStats(statsResponse));
    setHostStatus(normalizeHostStatus(hostStatusResponse));
  };

  const refreshHostStatus = async () => {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ status?: HostStatus }>({ type: 'GET_HOST_STATUS' });
      setHostStatus(normalizeHostStatus(response?.status));
      return;
    }

    const response = await fetch('/api/host-status').then((result) => result.json());
    setHostStatus(normalizeHostStatus(response));
  };

  const refreshHostStats = async () => {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ stats?: HostStats; status?: HostStatus }>({ type: 'GET_HOST_STATS' });
      if (response?.stats) {
        setHostStats(normalizeHostStats(response.stats));
      } else {
        setHostStats(DEFAULT_HOST_STATS);
      }
      if (response?.status) {
        setHostStatus(normalizeHostStatus(response.status));
      }
      return;
    }

    const stats = await fetch('/api/stats').then((result) => result.json());
    setHostStats(normalizeHostStats(stats));
  };

  const refreshPermissionStatus = async () => {
    if (!isExtensionRuntimeAvailable()) {
      setPermissionStatus(DEFAULT_PERMISSION_STATUS);
      return;
    }

    const response = await sendExtensionMessage<{ status?: PermissionStatus; error?: string }>({ type: 'GET_PERMISSION_STATUS' });
    if (response?.error) {
      setPermissionNotice(response.error);
      return;
    }
    setPermissionNotice(null);
    setPermissionStatus(normalizePermissionStatus(response?.status));
  };

  const refreshDownloads = async () => {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'GET_DOWNLOADS' });
      return;
    }

    const previewDownloads = await fetch('/api/downloads').then((response) => response.json());
    setDownloads(previewDownloads);
  };

  const refreshDetectedStreams = async () => {
    if (!isExtensionRuntimeAvailable()) {
      setDetectedStreams([]);
      setGrabberNotice('Detected streams require extension runtime. Open popup in browser.');
      return;
    }

    const response = await sendExtensionMessage<{ streams?: DetectedStreamItem[]; error?: string }>({ type: 'GET_DETECTED_STREAMS' });
    if (response?.error) {
      setGrabberNotice(response.error);
      return;
    }

    setDetectedStreams(normalizeDetectedStreamList(response?.streams));
    setGrabberNotice(null);
  };

  const buildDownloadSchedule = (): DownloadSchedulePayload | undefined => {
    if (!scheduleEnabled) {
      return undefined;
    }

    return {
      start_hour: normalizeScheduleHour(scheduleStartHour),
      end_hour: normalizeScheduleHour(scheduleEndHour),
      days: [...scheduleDays],
    };
  };

  const resetAddDownloadForm = () => {
    setUrlInput('');
    setScheduleEnabled(false);
    setScheduleStartHour(2);
    setScheduleEndHour(6);
    setScheduleDays(DEFAULT_SCHEDULE_DAYS);
    setIsAdding(false);
  };

  const toggleScheduleDay = (day: number) => {
    setScheduleDays((previous) => toggleScheduleDayValue(previous, day));
  };

  const normalizedUrlInput = urlInput.trim();
  const canAddDownload = isValidDownloadUrl(normalizedUrlInput);

  useEffect(() => {
    void loadInterceptionSettings();
    void loadHostSettings();
  }, []);

  useEffect(() => {
    setSelectedGrabberVariants((previous) => Object.fromEntries(
      Object.entries(previous).filter(([entryId]) => detectedStreams.some((stream) => stream.id === entryId)),
    ));
  }, [detectedStreams]);

  useEffect(() => {
    if (isExtensionRuntimeAvailable()) {
      const runtime = getChromeRuntime();
      if (!runtime?.onMessage) {
        return undefined;
      }

      const listener = (message: any) => {
        if (message.type === 'PROGRESS_UPDATE') {
          setDownloads((prev) => {
            const exists = prev.find((download) => download.id === message.payload.id);
            if (exists) {
              return prev.map((download) => (download.id === message.payload.id ? { ...download, ...message.payload } : download));
            }
            return [...prev, message.payload];
          });
        } else if (message.type === 'LIST_UPDATE') {
          setDownloads(message.payload || []);
        } else if (message.type === 'INTERCEPTION_SETTINGS_UPDATED') {
          applyInterceptionSettings(message.payload || {}, true);
        } else if (message.type === 'HOST_SETTINGS_UPDATED') {
          applyHostSettings(message.payload || {});
        } else if (message.type === 'HOST_STATUS') {
          setHostStatus(normalizeHostStatus(message.payload));
        } else if (message.type === 'PERMISSIONS_UPDATED') {
          setPermissionStatus(normalizePermissionStatus(message.payload));
        } else if (message.type === 'DETECTED_STREAMS_UPDATED') {
          void refreshDetectedStreams();
        }
      };

      runtime.onMessage.addListener(listener);
      void refreshDownloads();
      void refreshHostStatus();
      void refreshHostStats();
      void refreshPermissionStatus();
      void refreshDetectedStreams();

      const interval = window.setInterval(() => {
        void refreshHostStats();
      }, 2000);

      return () => {
        window.clearInterval(interval);
        runtime.onMessage.removeListener(listener);
      };
    }

    void refreshPreviewData();
    const interval = window.setInterval(() => {
      void refreshPreviewData();
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const addDownload = async () => {
    if (!canAddDownload) {
      return;
    }

    const schedule = buildDownloadSchedule();

    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({
        type: 'START_DOWNLOAD',
        url: normalizedUrlInput,
        segments: segmentsCount,
        schedule,
      });
      void refreshHostStats();
    } else {
      const response = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrlInput, segments: segmentsCount, schedule }),
      });
      const newDownload = await response.json();
      setDownloads([...downloads, newDownload]);
    }

    resetAddDownloadForm();
  };

  const closeRefreshUrlModal = () => {
    setRefreshUrlDialog(null);
    setRefreshUrlInput('');
    setRefreshUrlError(null);
    setRefreshUrlMismatch(null);
    setIsRefreshingUrl(false);
    setIsLoadingCurrentTabUrl(false);
  };

  const openRefreshUrlModal = (download: DownloadItem, nextUrl = '') => {
    setRefreshContextMenu(null);
    setRefreshUrlDialog({
      id: download.id,
      label: getDownloadLabel(download),
      currentUrl: download.url || '',
    });
    setRefreshUrlInput(nextUrl || download.url || '');
    setRefreshUrlError(null);
    setRefreshUrlMismatch(null);
  };

  const loadCurrentTabUrlIntoRefreshModal = async (download: DownloadItem) => {
    openRefreshUrlModal(download, refreshUrlInput);
    if (!isExtensionRuntimeAvailable()) {
      setRefreshUrlError('Current tab shortcut requires extension runtime.');
      return;
    }

    setIsLoadingCurrentTabUrl(true);
    try {
      const response = await sendExtensionMessage<ActiveTabUrlResponse>({ type: 'GET_ACTIVE_TAB_URL' });
      if (response?.error) {
        setRefreshUrlError(response.error);
        return;
      }
      const nextUrl = String(response?.url || '').trim();
      if (!isValidDownloadUrl(nextUrl)) {
        setRefreshUrlError('Current tab URL is not valid http(s) download link.');
        return;
      }
      setRefreshUrlInput(nextUrl);
      setRefreshUrlError(null);
      setRefreshUrlMismatch(null);
    } finally {
      setIsLoadingCurrentTabUrl(false);
    }
  };

  const submitRefreshDownloadUrl = async ({ force = false, restartFromScratch = false }: { force?: boolean; restartFromScratch?: boolean } = {}) => {
    if (!refreshUrlDialog) {
      return;
    }

    const nextUrl = refreshUrlInput.trim();
    if (!isValidDownloadUrl(nextUrl)) {
      setRefreshUrlError('Enter valid http(s) URL before refreshing.');
      return;
    }

    setIsRefreshingUrl(true);
    setRefreshUrlError(null);
    if (!force && !restartFromScratch) {
      setRefreshUrlMismatch(null);
    }

    try {
      let response: RefreshUrlResponse | undefined;
      if (isExtensionRuntimeAvailable()) {
        response = await sendExtensionMessage<RefreshUrlResponse>({
          type: 'REFRESH_DOWNLOAD_URL',
          id: refreshUrlDialog.id,
          url: nextUrl,
          force,
          restartFromScratch,
        });
      } else {
        response = await fetch(`/api/downloads/${refreshUrlDialog.id}/refresh-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: nextUrl, force, restartFromScratch }),
        }).then((result) => result.json());
      }

      if (response?.error) {
        setRefreshUrlError(response.error);
        setRefreshUrlMismatch(response.code ? { code: response.code, message: response.error, details: response.details ?? null } : null);
        return;
      }

      closeRefreshUrlModal();
      if (isExtensionRuntimeAvailable()) {
        void refreshDownloads();
        void refreshHostStats();
      } else {
        await refreshPreviewData();
      }
    } catch (error) {
      setRefreshUrlError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRefreshingUrl(false);
    }
  };

  const togglePlayPause = async (download: DownloadItem) => {
    if (downloadNeedsUrlRefresh(download)) {
      openRefreshUrlModal(download);
      return;
    }

    const currentStatus = download.status;
    const id = download.id;
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({
        type: currentStatus === 'downloading' || currentStatus === 'queued' || currentStatus === 'muxing' ? 'PAUSE_DOWNLOAD' : 'RESUME_DOWNLOAD',
        id,
      });
      void refreshHostStats();
      return;
    }

    await fetch(`/api/downloads/${id}/${currentStatus === 'downloading' || currentStatus === 'muxing' ? 'pause' : 'resume'}`, { method: 'POST' });
    setDownloads(
      downloads.map((download) =>
        download.id === id
          ? {
            ...download,
            status: currentStatus === 'downloading' || currentStatus === 'muxing' ? 'paused' : 'downloading',
            speed: '0 B/s',
            speed_bytes_per_second: 0,
          }
          : download,
      ),
    );
  };

  const toggleAllDownloads = async (action: 'pause' | 'resume') => {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: action === 'pause' ? 'PAUSE_ALL_DOWNLOADS' : 'RESUME_ALL_DOWNLOADS' });
      void refreshDownloads();
      void refreshHostStats();
      return;
    }

    await fetch(`/api/downloads/${action}-all`, { method: 'POST' });
    await refreshPreviewData();
  };

  const openOptionsPage = () => {
    const runtime = getChromeRuntime();
    if (runtime?.openOptionsPage) {
      runtime.openOptionsPage();
      return;
    }

    window.open('/options.html', '_blank', 'noopener,noreferrer');
  };

  const requestAllUrlsPermission = async () => {
    if (!isExtensionRuntimeAvailable()) {
      return;
    }

    const response = await sendExtensionMessage<{ granted?: boolean; status?: PermissionStatus; error?: string }>({ type: 'REQUEST_ALL_URLS_PERMISSION' });
    if (response?.error) {
      setPermissionNotice(response.error);
      return;
    }
    if (response?.status) {
      setPermissionStatus(normalizePermissionStatus(response.status));
    }
    setPermissionNotice(response?.granted ? null : 'All-sites access not granted. Per-origin access still works.');
  };

  const dismissPermissionOnboarding = async () => {
    if (!isExtensionRuntimeAvailable()) {
      return;
    }

    const response = await sendExtensionMessage<{ status?: PermissionStatus; error?: string }>({ type: 'DISMISS_PERMISSION_ONBOARDING' });
    if (response?.error) {
      setPermissionNotice(response.error);
      return;
    }
    setPermissionNotice(null);
    setPermissionStatus(normalizePermissionStatus(response?.status));
  };

  const requestCurrentOriginPermission = async () => {
    if (!isExtensionRuntimeAvailable()) {
      return;
    }

    const response = await sendExtensionMessage<{ granted?: boolean; status?: PermissionStatus; error?: string }>({ type: 'REQUEST_CURRENT_TAB_PERMISSION' });
    if (response?.error) {
      setPermissionNotice(response.error);
      return;
    }
    if (response?.status) {
      setPermissionStatus(normalizePermissionStatus(response.status));
    }
    setPermissionNotice(response?.granted ? null : 'Current tab access not granted.');
  };

  const revokeGrantedPermission = async (origin: string) => {
    if (!isExtensionRuntimeAvailable()) {
      return;
    }

    const response = await sendExtensionMessage<{ status?: PermissionStatus; error?: string }>({
      type: 'REVOKE_GRANTED_PERMISSION',
      origin,
    });
    if (response?.error) {
      setPermissionNotice(response.error);
      return;
    }
    setPermissionNotice(null);
    setPermissionStatus(normalizePermissionStatus(response?.status));
  };

  const openLogs = async () => {
    if (!isExtensionRuntimeAvailable()) {
      return;
    }

    const response = await sendExtensionMessage<{ error?: string }>({ type: 'OPEN_LOGS' });
    if (response?.error) {
      console.error('Failed to open host logs:', response.error);
    }
  };

  const removeDownload = async (id: number | string, deleteFile: boolean) => {
    setRemovalTarget(null);

    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ error?: string }>({
        type: 'REMOVE_DOWNLOAD',
        id,
        deleteFile,
      });

      if (response?.error) {
        console.error('Failed to remove download:', response.error);
      }
      void refreshDownloads();
      void refreshHostStats();
      return;
    }

    await fetch(`/api/downloads/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteFile }),
    });
    await refreshPreviewData();
  };

  const commitDownloadDir = async (nextDownloadDir?: string) => {
    const nextSettings = {
      ...hostSettings,
      downloadDir: (nextDownloadDir ?? downloadDirInput).trim(),
    };

    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ settings?: HostSettings; error?: string }>({
        type: 'UPDATE_HOST_SETTINGS',
        settings: nextSettings,
      });

      if (response?.error) {
        setDownloadDirError(response.error);
        setDownloadDirInput(hostSettings.downloadDir);
        return;
      }

      if (response?.settings) {
        applyHostSettings(response.settings);
        return;
      }
    }

    localStorage.setItem(HOST_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeHostSettings(nextSettings)));
    applyHostSettings(nextSettings);
  };

  const pickDownloadDirectory = async () => {
    if (!isExtensionRuntimeAvailable()) {
      setDownloadDirError('Directory picker requires native host access. Type absolute path manually.');
      return;
    }

    const response = await sendExtensionMessage<{ path?: string; error?: string }>({
      type: 'PICK_DOWNLOAD_DIRECTORY',
      initial: downloadDirInput.trim() || hostSettings.downloadDir,
    });

    if (response?.error) {
      setDownloadDirError(response.error);
      return;
    }
    if (!response?.path) {
      return;
    }

    setDownloadDirInput(response.path);
    await commitDownloadDir(response.path);
  };

  const openDownloadFile = async (id: number | string) => {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ error?: string }>({ type: 'OPEN_DOWNLOAD_FILE', id });
      if (response?.error) {
        console.error('Failed to open download file:', response.error);
      }
      return;
    }

    await fetch(`/api/downloads/${id}/open`, { method: 'POST' });
  };

  const revealDownloadInFolder = async (id: number | string) => {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ error?: string }>({ type: 'REVEAL_DOWNLOAD_IN_FOLDER', id });
      if (response?.error) {
        console.error('Failed to reveal download file:', response.error);
      }
      return;
    }

    await fetch(`/api/downloads/${id}/reveal`, { method: 'POST' });
  };

  const selectedVariantForStream = (stream: DetectedStreamItem) =>
    selectedGrabberVariants[stream.id] || stream.selectedVariantId || stream.qualities?.[0]?.id || '';

  const startVideoDownload = async (stream: DetectedStreamItem) => {
    if (!isExtensionRuntimeAvailable()) {
      setGrabberNotice('Video grabber requires extension runtime.');
      return;
    }

    setGrabberBusyUrl(stream.id);
    setGrabberNotice(null);
    try {
      const response = await sendExtensionMessage<{ error?: string }>({
        type: 'START_DETECTED_MEDIA_DOWNLOAD',
        id: stream.id,
        selectedVariantId: selectedVariantForStream(stream),
      });
      if (response?.error) {
        setGrabberNotice(response.error);
        return;
      }
      setGrabberNotice(`Queued ${stream.label}.`);
      void refreshDownloads();
      void refreshHostStats();
    } catch (error) {
      setGrabberNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setGrabberBusyUrl(null);
    }
  };

  const reviewDetectedStream = async (stream: DetectedStreamItem) => {
    if (!isExtensionRuntimeAvailable()) {
      setGrabberNotice('Overlay review requires extension runtime.');
      return;
    }
    if (!stream.manifestType) {
      setGrabberNotice('Overlay review works only for HLS/DASH manifests.');
      return;
    }

    const response = await sendExtensionMessage<{ error?: string }>({
      type: 'SHOW_DETECTED_STREAM_OVERLAY',
      url: stream.url,
      manifestType: stream.manifestType,
    });
    if (response?.error) {
      setGrabberNotice(response.error);
      return;
    }
    setGrabberNotice('Overlay sent to active tab.');
  };

  const scanPageForVideos = async () => {
    if (!isExtensionRuntimeAvailable()) {
      setGrabberNotice('Scan works only inside extension popup.');
      return;
    }

    setIsScanningPage(true);
    setGrabberNotice(null);
    const response = await sendExtensionMessage<{ streams?: DetectedStreamItem[]; error?: string }>({ type: 'SCAN_PAGE' });
    setIsScanningPage(false);

    if (response?.error) {
      setGrabberNotice(response.error);
      return;
    }

    const streams = normalizeDetectedStreamList(response?.streams);
    setDetectedStreams(streams);
    setGrabberNotice(streams.length > 0 ? null : 'No media URLs found on current page.');
  };

  const copyPathToClipboard = async (value: string | undefined) => {
    if (!value) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }

      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (error) {
      console.error('Failed to copy output path:', error);
    }
  };

  const filteredDownloads = downloads.filter((download) => {
    if (activeTab === 'grabber') {
      return download.type === 'video';
    }
    if (activeTab === 'all') {
      return true;
    }
    if (activeTab === 'active') {
      return download.status === 'downloading' || download.status === 'queued' || download.status === 'muxing';
    }
    if (activeTab === 'finished') {
      return download.status === 'finished';
    }
    return true;
  });

  const activeConnections = downloads.filter(
    (download) => download.status === 'downloading' || download.status === 'queued' || download.status === 'muxing',
  ).length * segmentsCount;

  const openRepository = () => {
    window.open(REPOSITORY_URL, '_blank', 'noopener,noreferrer');
  };

  const settingsSections = (
    <>
      <div>
        <label className="text-[13px] font-medium mb-1.5 flex justify-between tracking-wide text-white/90">
          <span>Download Segments</span>
          <span className="font-mono bg-white/10 text-white/80 rounded px-2">{segmentsCount}</span>
        </label>
        <p className="text-[10px] uppercase font-mono mb-4 tracking-wider text-white/40 block">Number of parallel connections per file</p>
        <input
          type="range"
          min="1"
          max="32"
          value={segmentsCount}
          onChange={(event) => {
            const nextValue = parseInt(event.target.value, 10);
            setSegmentsCount(nextValue);
            localStorage.setItem('tuyuldm_segments', nextValue.toString());
          }}
          className="w-full accent-white"
        />
        <div className="flex justify-between text-[10px] font-mono mt-2 text-white/40">
          <span>1</span>
          <span>32</span>
        </div>
      </div>

      <div className="pt-6 mt-6 border-t border-white/10 space-y-4">
        <div>
          <label className="text-[13px] font-medium mb-1.5 flex justify-between tracking-wide text-white/90">
            <span>Concurrent Downloads</span>
            <span className="font-mono bg-white/10 text-white/80 rounded px-2">{hostSettings.maxConcurrentDownloads}</span>
          </label>
          <p className="text-[10px] uppercase font-mono mb-4 tracking-wider text-white/40 block">Downloads allowed to run from queue at once</p>
          <input
            type="range"
            min="1"
            max="32"
            value={hostSettings.maxConcurrentDownloads}
            onChange={(event) => {
              const nextValue = parseInt(event.target.value, 10);
              void persistHostSettings({
                ...hostSettings,
                maxConcurrentDownloads: nextValue,
              });
            }}
            className="w-full accent-white"
          />
          <div className="flex justify-between text-[10px] font-mono mt-2 text-white/40">
            <span>1</span>
            <span>32</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[13px] font-medium tracking-wide text-white/90">Download Directory</label>
              <button
                type="button"
                onClick={() => void pickDownloadDirectory()}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/60 transition-colors hover:border-white/20 hover:text-white/85"
              >
                Browse...
              </button>
            </div>
            <p className="text-[10px] uppercase font-mono tracking-wider text-white/40">Absolute path used for completed downloads and segment cache</p>
            <input
              type="text"
              value={downloadDirInput}
              onChange={(event) => {
                setDownloadDirInput(event.target.value);
                if (downloadDirError) {
                  setDownloadDirError(null);
                }
              }}
              onBlur={() => void commitDownloadDir()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitDownloadDir();
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              placeholder="/home/user/Downloads"
              className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
            />
            {downloadDirError && <p className="text-[11px] text-red-300">{downloadDirError}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium tracking-wide text-white/90">Global Throttle</label>
            <p className="text-[10px] uppercase font-mono tracking-wider text-white/40">KB/s across every active download, 0 disables the cap</p>
            <input
              type="number"
              min="0"
              step="1"
              value={kilobytesPerSecondFromBytes(hostSettings.globalThrottleBytesPerSecond)}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                void persistHostSettings({
                  ...hostSettings,
                  globalThrottleBytesPerSecond: bytesPerSecondFromKilobytes(Number.isFinite(nextValue) ? nextValue : 0),
                });
              }}
              className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium tracking-wide text-white/90">Per-Download Throttle</label>
            <p className="text-[10px] uppercase font-mono tracking-wider text-white/40">KB/s shared by one download across its segment workers, 0 disables the cap</p>
            <input
              type="number"
              min="0"
              step="1"
              value={kilobytesPerSecondFromBytes(hostSettings.perDownloadThrottleBytesPerSecond)}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                void persistHostSettings({
                  ...hostSettings,
                  perDownloadThrottleBytesPerSecond: bytesPerSecondFromKilobytes(Number.isFinite(nextValue) ? nextValue : 0),
                });
              }}
              className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="pt-6 mt-6 border-t border-white/10 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label className="text-[13px] font-medium tracking-wide text-white/90">Automatic Interception</label>
            <p className="text-[10px] uppercase font-mono mt-1 tracking-wider text-white/40">Request origin access only when a matching download is detected</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={interceptionSettings.enabled}
              onChange={(event) => {
                void persistInterceptionSettings({
                  ...interceptionSettings,
                  enabled: event.target.checked,
                });
              }}
              className="sr-only peer"
            />
            <span className="relative h-6 w-11 rounded-full bg-white/10 transition-colors peer-checked:bg-white/80">
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-transform ${interceptionSettings.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </span>
          </label>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/2 p-4">
          <div>
            <label className="text-[13px] font-medium tracking-wide text-white/90">Auto-Show Detected Streams</label>
            <p className="text-[10px] uppercase font-mono mt-1 tracking-wider text-white/40">Open overlay on detected manifests instead of waiting for the popup grabber tab</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={interceptionSettings.autoShowDetectedStreams}
              onChange={(event) => {
                void persistInterceptionSettings({
                  ...interceptionSettings,
                  autoShowDetectedStreams: event.target.checked,
                });
              }}
              className="sr-only peer"
            />
            <span className="relative h-6 w-11 rounded-full bg-white/10 transition-colors peer-checked:bg-white/80">
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-transform ${interceptionSettings.autoShowDetectedStreams ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-[13px] font-medium tracking-wide text-white/90">Intercept File Extensions</label>
            <p className="text-[10px] uppercase font-mono tracking-wider text-white/40">One per line or comma separated</p>
            <textarea
              rows={4}
              value={extensionRulesInput}
              onChange={(event) => {
                const value = event.target.value;
                setExtensionRulesInput(value);
                void persistInterceptionSettings({
                  ...interceptionSettings,
                  extensions: parseSettingsList(value, normalizeExtensionRule),
                });
              }}
              placeholder=".zip&#10;.iso&#10;.mp4"
              className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors resize-y min-h-28"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium tracking-wide text-white/90">Minimum Size</label>
            <p className="text-[10px] uppercase font-mono tracking-wider text-white/40">Only applies when the browser exposes a file size</p>
            <input
              type="number"
              min="0"
              step="1"
              value={interceptionSettings.minFileSizeMB}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                void persistInterceptionSettings({
                  ...interceptionSettings,
                  minFileSizeMB: Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0,
                });
              }}
              className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium tracking-wide text-white/90">Current Scope</label>
            <div className="h-full min-h-[108px] rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[12px] text-white/70 leading-6">
              <p>Allowed origins: {interceptionSettings.allowDomains.length > 0 ? interceptionSettings.allowDomains.length : 'all matching domains'}</p>
              <p>Blocked domains: {interceptionSettings.blockDomains.length}</p>
              <p>Extensions: {interceptionSettings.extensions.length}</p>
              <p>Overlay: {interceptionSettings.autoShowDetectedStreams ? 'auto-show' : 'popup only'}</p>
              <p>Auto schedule: {formatScheduleSummary(
                interceptionSettings.scheduleEnabled,
                interceptionSettings.scheduleStartHour,
                interceptionSettings.scheduleEndHour,
                interceptionSettings.scheduleDays,
              )}</p>
            </div>
          </div>

          <div className="space-y-4 sm:col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="text-[13px] font-medium tracking-wide text-white/90">Default Schedule for Auto Starts</label>
                <p className="text-[10px] uppercase font-mono mt-1 tracking-wider text-white/40">Applies to intercepted downloads and seeds the video overlay before start</p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={interceptionSettings.scheduleEnabled}
                  onChange={(event) => {
                    void persistInterceptionSettings({
                      ...interceptionSettings,
                      scheduleEnabled: event.target.checked,
                    });
                  }}
                  className="sr-only peer"
                />
                <span className="relative h-6 w-11 rounded-full bg-white/10 transition-colors peer-checked:bg-white/80">
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-transform ${interceptionSettings.scheduleEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </span>
              </label>
            </div>

            {interceptionSettings.scheduleEnabled && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[13px] font-medium tracking-wide text-white/90">Start Hour</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      step="1"
                      value={interceptionSettings.scheduleStartHour}
                      onChange={(event) => {
                        const nextValue = Number.parseInt(event.target.value, 10);
                        void persistInterceptionSettings({
                          ...interceptionSettings,
                          scheduleStartHour: normalizeScheduleHour(Number.isFinite(nextValue) ? nextValue : 0),
                        });
                      }}
                      className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[13px] font-medium tracking-wide text-white/90">End Hour</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      step="1"
                      value={interceptionSettings.scheduleEndHour}
                      onChange={(event) => {
                        const nextValue = Number.parseInt(event.target.value, 10);
                        void persistInterceptionSettings({
                          ...interceptionSettings,
                          scheduleEndHour: normalizeScheduleHour(Number.isFinite(nextValue) ? nextValue : 0),
                        });
                      }}
                      className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[13px] font-medium tracking-wide text-white/90">Days</label>
                  <div className="grid grid-cols-7 gap-2">
                    {WEEKDAY_OPTIONS.map((option) => {
                      const active = interceptionSettings.scheduleDays.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            void persistInterceptionSettings({
                              ...interceptionSettings,
                              scheduleDays: toggleScheduleDayValue(interceptionSettings.scheduleDays, option.value),
                            });
                          }}
                          className={active
                            ? 'rounded-xl border border-white/40 bg-white text-black px-3 py-2 text-[11px] font-mono uppercase tracking-widest transition-colors'
                            : 'rounded-xl border border-white/10 bg-[#0A0A0A] text-white/60 px-3 py-2 text-[11px] font-mono uppercase tracking-widest transition-colors hover:border-white/30 hover:text-white/90'}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium tracking-wide text-white/90">Allowlisted Domains</label>
            <p className="text-[10px] uppercase font-mono tracking-wider text-white/40">Leave empty to allow any domain that matches the file rules</p>
            <textarea
              rows={4}
              value={allowDomainsInput}
              onChange={(event) => {
                const value = event.target.value;
                setAllowDomainsInput(value);
                void persistInterceptionSettings({
                  ...interceptionSettings,
                  allowDomains: parseSettingsList(value, normalizeDomainRule),
                });
              }}
              placeholder="downloads.example.com&#10;cdn.example.net"
              className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors resize-y min-h-28"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium tracking-wide text-white/90">Blocked Domains</label>
            <p className="text-[10px] uppercase font-mono tracking-wider text-white/40">Block interception for domains that should stay in the browser</p>
            <textarea
              rows={4}
              value={blockDomainsInput}
              onChange={(event) => {
                const value = event.target.value;
                setBlockDomainsInput(value);
                void persistInterceptionSettings({
                  ...interceptionSettings,
                  blockDomains: parseSettingsList(value, normalizeDomainRule),
                });
              }}
              placeholder="docs.example.com&#10;viewer.example.org"
              className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors resize-y min-h-28"
            />
          </div>

          {isOptionsSurface && (
            <div className="space-y-4 sm:col-span-2 rounded-2xl border border-white/10 bg-white/2 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label className="text-[13px] font-medium tracking-wide text-white/90">Granted Origin Permissions</label>
                  <p className="text-[10px] uppercase font-mono mt-1 tracking-wider text-white/40">Optional host permissions currently granted to the extension</p>
                </div>
                {!permissionStatus.hasAllUrlsPermission && (
                  <button
                    type="button"
                    onClick={() => void requestAllUrlsPermission()}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/60 transition-colors hover:border-white/20 hover:text-white/85"
                  >
                    Grant All Sites
                  </button>
                )}
              </div>

              {permissionNotice && <p className="text-[11px] text-amber-200">{permissionNotice}</p>}

              {permissionStatus.grantedOrigins.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-[#0A0A0A] px-4 py-4 text-sm text-white/55">
                  No optional origins granted yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {permissionStatus.grantedOrigins.map((origin) => (
                    <div key={origin} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0A0A0A] px-4 py-3">
                      <div className="min-w-0 text-sm text-white/80">
                        <div className="truncate" title={origin}>{formatGrantedOrigin(origin)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void revokeGrantedPermission(origin)}
                        className="rounded-lg border border-red-500/20 px-3 py-1.5 text-[11px] uppercase tracking-wider text-red-200 transition-colors hover:bg-red-500/10"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  const settingsActions = (
    <div className="pt-6 mt-6 border-t border-white/10 flex items-center justify-between gap-3">
      <button
        onClick={openOptionsPage}
        className="px-4 py-2.5 border border-white/10 text-white/80 rounded-lg font-medium hover:bg-white/5 transition-colors"
      >
        Open Full Options
      </button>
      <button
        onClick={() => setIsSettingsOpen(false)}
        className="px-6 py-2.5 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-colors shadow-sm"
      >
        Done
      </button>
    </div>
  );

  if (isOptionsSurface) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-[#EDEDED] px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 backdrop-blur-xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-mono">Extension Options</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">TuyulDM Control Room</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                  Configure download concurrency, browser interception rules, and inspect the native host without opening the popup.
                </p>
              </div>

              <div className="grid gap-3 rounded-2xl border border-white/10 bg-[#121212] p-4 text-sm text-white/70 sm:grid-cols-3 lg:min-w-[420px]">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-mono text-white/40">Host</p>
                  <p className={hostStatus.connected ? 'mt-2 text-green-400 font-medium' : 'mt-2 text-amber-300 font-medium'}>
                    {hostStatus.connected ? 'Connected' : 'Disconnected'}
                  </p>
                  <p className="mt-1 text-xs text-white/50">{hostStatus.protocolVersion}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-mono text-white/40">Global Speed</p>
                  <p className="mt-2 font-medium text-white/90">{formatSpeed(hostStats.globalSpeedBytesPerSecond)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-mono text-white/40">Free Space</p>
                  <p className="mt-2 font-medium text-white/90">{formatSize(hostStats.freeSpaceBytes)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_360px]">
            <section className="rounded-3xl border border-white/10 bg-[#141414] p-8 shadow-2xl">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
                <Settings className="w-5 h-5 text-white/50" /> Settings
              </h2>
              <div className="space-y-6">{settingsSections}</div>
            </section>

            <aside className="space-y-6">
              <div id="drm-policy" className="rounded-3xl border border-red-500/20 bg-red-500/5 p-6 backdrop-blur-xl">
                <p className="text-[10px] uppercase tracking-widest font-mono text-red-200/70">DRM Policy</p>
                <h3 className="mt-3 text-lg font-semibold text-white">Protected streams are refused</h3>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  TuyulDM downloads clear HLS and DASH manifests only. If a manifest advertises SAMPLE-AES, AES-128, Widevine, or other DRM signaling,
                  the host refuses it and no key retrieval path is attempted.
                </p>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  Reason: no key handling, no license exchange, no Widevine path. Refusal is intentional and should appear in the overlay as a red error banner.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/2 p-6 backdrop-blur-xl space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-mono text-white/40">Queue Snapshot</p>
                  <div className="mt-4 space-y-3 text-sm text-white/70">
                    <div className="flex items-center justify-between">
                      <span>Downloads tracked</span>
                      <span className="font-mono text-white/90">{downloads.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Active downloads</span>
                      <span className="font-mono text-white/90">{hostStats.activeDownloads}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Queue cap</span>
                      <span className="font-mono text-white/90">{hostSettings.maxConcurrentDownloads}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Segments per file</span>
                      <span className="font-mono text-white/90">x{segmentsCount}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#121212] p-4 text-sm text-white/60">
                  <p className="font-medium text-white/85">Native host state</p>
                  <p className="mt-2 leading-6">
                    {hostStatus.connected
                      ? 'The popup and options page are reading live state from the native host.'
                      : hostStatus.lastError || 'The native host is unavailable. The extension UI will stay usable, but downloads will not start until the host reconnects.'}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  const grabberPanel = (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-[#141414] p-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-mono text-white/40">Detected Media</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">Video Grabber</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Scan current page for manifests, MSE-backed media, and direct files. Pick quality in popup, then queue download.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void refreshDetectedStreams()}
            className="rounded-xl border border-white/10 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void scanPageForVideos()}
            disabled={isScanningPage}
            className="rounded-xl bg-white px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isScanningPage ? 'Scanning...' : 'Scan Page'}
          </button>
        </div>
      </div>

      {grabberNotice && (
        <div className="rounded-2xl border border-white/10 bg-white/2 px-4 py-3 text-sm text-white/70">
          {grabberNotice}
        </div>
      )}

      <div className="rounded-3xl border border-white/10 bg-[#111111] p-4">
        {detectedStreams.length === 0 ? (
          <div className="flex min-h-55 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/2 px-6 py-10 text-center">
            <p className="text-sm font-medium text-white/85">No detected media yet</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/50">
              Open page with HLS, DASH, blob/MSE, or direct video, then run Scan Page. Network and page-hook hits appear here after detection fires.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {detectedStreams.map((stream) => (
              <div key={stream.id} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/2 px-4 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40">
                      <span>{stream.label}</span>
                      <span>{stream.manifestType || stream.kind}</span>
                      <span>{formatDetectedMediaSource(stream.source)}</span>
                      <span>{formatDetectedTimestamp(stream.detectedAt)}</span>
                      {stream.protected && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-100">
                          <Lock className="h-3 w-3" />
                          DRM
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex gap-4">
                      {stream.posterUrl && (
                        <img
                          src={stream.posterUrl}
                          alt=""
                          className="h-18 w-32 rounded-xl border border-white/10 object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="truncate text-sm text-white/90" title={stream.url}>{stream.url}</div>
                        {stream.pageUrl && (
                          <div className="truncate text-xs text-white/40" title={stream.pageUrl}>{stream.pageUrl}</div>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
                          {typeof stream.sizeHint === 'number' && stream.sizeHint > 0 && <span>{formatSize(stream.sizeHint)}</span>}
                          {stream.qualities && stream.qualities.length === 1 && <span>{formatVariantLabel(stream.qualities[0])}</span>}
                        </div>
                        {stream.protected && stream.protectedReason && (
                          <div className="rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-100">
                            {stream.protectedReason}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 lg:w-72 lg:flex-none">
                    {stream.qualities && stream.qualities.length > 1 && (
                      <select
                        value={selectedVariantForStream(stream)}
                        onChange={(event) => setSelectedGrabberVariants((previous) => ({
                          ...previous,
                          [stream.id]: event.target.value,
                        }))}
                        className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                      >
                        {stream.qualities.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {formatVariantLabel(variant)}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => void reviewDetectedStream(stream)}
                        disabled={!stream.manifestType}
                        className="rounded-xl border border-white/10 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        onClick={() => void startVideoDownload(stream)}
                        disabled={grabberBusyUrl === stream.id || stream.protected}
                        className="rounded-xl bg-white px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {grabberBusyUrl === stream.id ? 'Queueing...' : 'Download'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const permissionOnboardingCard = isPopupSurface && permissionStatus.shouldShowOnboarding && !permissionStatus.hasAllUrlsPermission ? (
    <div className="border-b border-white/5 px-6 py-4 bg-[#0A0A0A]/95 backdrop-blur-md">
      <div className="rounded-2xl border border-white/10 bg-white/2 p-4">
        <p className="text-[10px] uppercase tracking-widest font-mono text-white/40">Permission Setup</p>
        <h2 className="mt-2 text-sm font-semibold text-white">Detection works best with optional site access</h2>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Grant all-sites access once to let webRequest detection see manifests across origins. You can still use per-origin access from footer CTA if you want tighter scope.
        </p>
        {permissionNotice && <p className="mt-3 text-[11px] text-amber-200">{permissionNotice}</p>}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => void requestAllUrlsPermission()}
            className="rounded-xl bg-white px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-black transition-colors hover:bg-white/90"
          >
            Grant All Sites
          </button>
          <button
            type="button"
            onClick={() => void dismissPermissionOnboarding()}
            className="rounded-xl border border-white/10 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#0A0A0A] text-[#EDEDED]">
      <aside className="w-64 border-r border-white/5 flex flex-col bg-white/[0.02] backdrop-blur-xl">
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-white/10 p-2 rounded-xl border border-white/10 shadow-inner">
              <Download className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">TuyulDM</h1>
          </div>
          <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono">v0.1.0-alpha</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <SidebarItem active={activeTab === 'all'} onClick={() => setActiveTab('all')} icon={<Monitor className="w-4 h-4" />} label="All Downloads" />
          <SidebarItem
            active={activeTab === 'active'}
            onClick={() => setActiveTab('active')}
            icon={<Activity className="w-4 h-4" />}
            label="Active Queue"
            count={downloads.filter((download) => download.status === 'downloading').length}
          />
          <SidebarItem active={activeTab === 'finished'} onClick={() => setActiveTab('finished')} icon={<CheckCircle2 className="w-4 h-4" />} label="Finished" />
          <SidebarItem active={activeTab === 'grabber'} onClick={() => setActiveTab('grabber')} icon={<Video className="w-4 h-4" />} label="Video Grabber" />
        </nav>

        <div className="p-4 border-t border-white/5 space-y-1">
          <SidebarItem icon={<Activity className="w-4 h-4" />} label="Logs" onClick={() => void openLogs()} />
          <SidebarItem icon={<Settings className="w-4 h-4" />} label="Settings" onClick={() => setIsSettingsOpen(true)} />
          <SidebarItem icon={<Github className="w-4 h-4" />} label="Source Code" onClick={openRepository} />
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex-none border-b border-white/5 flex items-center justify-between px-6 bg-[#0A0A0A]/80 backdrop-blur-md z-20">
          <div className="flex gap-3">
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 px-4 py-1.5 bg-white text-black rounded-lg text-sm font-medium hover:bg-white/90 shadow-sm transition-all shadow-white/10"
            >
              <Plus className="w-4 h-4" /> Add URL
            </button>
            <ToolbarButton icon={<Play className="w-4 h-4" />} label="Resume All" onClick={() => void toggleAllDownloads('resume')} />
            <ToolbarButton icon={<Pause className="w-4 h-4" />} label="Pause All" onClick={() => void toggleAllDownloads('pause')} />
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="col-header mb-1">Global Speed</p>
              <p className="text-[13px] font-mono text-white/90">{formatSpeed(hostStats.globalSpeedBytesPerSecond)}</p>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="text-right">
              <p className="col-header mb-1">Free Space</p>
              <p className="text-[13px] font-mono text-white/90">{formatSize(hostStats.freeSpaceBytes)}</p>
            </div>
          </div>
        </header>

        {permissionOnboardingCard}

        <div className="flex-1 overflow-auto relative">
          {activeTab === 'grabber' ? grabberPanel : (
            <>
              <div className="grid grid-cols-[40px_1fr_120px_180px_120px_160px] gap-4 px-6 py-3 sticky top-0 border-b border-white/5 bg-[#0A0A0A]/90 backdrop-blur-xl z-10">
                <div className="col-header">ID</div>
                <div className="col-header">File Name</div>
                <div className="col-header">Size</div>
                <div className="col-header">Status / Progress</div>
                <div className="col-header">Speed</div>
                <div className="col-header">Actions</div>
              </div>

              <AnimatePresence>
                <div className="p-3 space-y-1">
                  {filteredDownloads.length === 0 ? (
                    <div className="rounded-3xl border border-white/10 bg-white/2 px-6 py-12 text-center">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">Queue Empty</p>
                      <h2 className="mt-3 text-lg font-semibold text-white">Nothing downloading yet</h2>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        Add a direct URL to start now. Browser-intercepted downloads will also appear here automatically.
                      </p>
                      <div className="mt-6 flex justify-center">
                        <button
                          type="button"
                          onClick={() => setIsAdding(true)}
                          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90"
                        >
                          <Plus className="w-4 h-4" /> Add URL
                        </button>
                      </div>
                    </div>
                  ) : filteredDownloads.map((download) => {
                    const isRefreshBlocked = downloadNeedsUrlRefresh(download);
                    const isActiveDownload = download.status === 'downloading' || download.status === 'queued' || download.status === 'muxing';
                    const statusClass = download.status === 'downloading'
                      ? 'text-blue-400'
                      : isRefreshBlocked
                        ? 'text-amber-300'
                        : download.status === 'error'
                          ? 'text-red-400'
                          : 'text-white/40';
                    const progressClass = download.status === 'finished'
                      ? 'bg-green-500'
                      : isRefreshBlocked
                        ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.35)]'
                        : download.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]';
                    return (
                      <motion.div
                        key={download.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        onContextMenu={(event) => {
                          if (!isPopupSurface || !isRefreshBlocked) {
                            return;
                          }
                          event.preventDefault();
                          setRefreshContextMenu({ id: download.id, x: event.clientX, y: event.clientY });
                        }}
                        className={`data-row grid grid-cols-[40px_1fr_120px_180px_120px_160px] gap-4 px-3 py-3 items-center group ${isPopupSurface && isRefreshBlocked ? 'cursor-context-menu' : ''}`}
                      >
                        <div className="data-value opacity-40">{typeof download.id === 'number' ? download.id.toString().padStart(2, '0') : download.id.substring(0, 4)}</div>
                        <div className="flex flex-col min-w-0 pr-4">
                          <div className="font-medium truncate text-[13px] text-white/90">{download.name || download.filename}</div>
                          {(download.extraction_strategy || download.site_key) && (
                            <div className="mt-1 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest">
                              {download.extraction_strategy && (
                                <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-white/70">
                                  {STRATEGY_LABELS[download.extraction_strategy as ExtractionStrategy] || download.extraction_strategy}
                                </span>
                              )}
                              {download.extraction_strategy && (
                                <span className="text-white/40">{strategyAssemblyKind(download.extraction_strategy)}</span>
                              )}
                              {download.site_key && (
                                <span className="text-white/40 truncate">{download.site_key}</span>
                              )}
                              {typeof download.track_count === 'number' && download.track_count > 0 && (
                                <span className="text-white/40">{download.track_count} tr</span>
                              )}
                              {download.assembly_stage && (
                                <span className="rounded-md border border-blue-400/25 bg-blue-400/10 px-1.5 py-0.5 text-blue-200">
                                  {download.assembly_stage}
                                </span>
                              )}
                              {download.extraction_strategy === 'unsupported_protected' && (
                                <span className="rounded-md border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-red-200">
                                  {describeProtectedReason(download.error_code || download.offer_debug?.protected_reason)}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => void copyPathToClipboard(JSON.stringify(buildSafeDebugSnapshot(download), null, 2))}
                                className="rounded-md border border-white/10 px-1.5 py-0.5 text-white/45 transition-colors hover:border-white/25 hover:text-white/80"
                                title="Copy strategy debug JSON"
                              >
                                debug
                              </button>
                            </div>
                          )}
                          {download.output_path && (
                            <div className="mt-1 flex items-center gap-1.5 min-w-0">
                              <div className="truncate text-[10px] font-mono text-white/35" title={download.output_path}>{getDownloadParentDirectory(download.output_path)}</div>
                              <button
                                type="button"
                                onClick={() => void copyPathToClipboard(download.output_path)}
                                className="flex-none rounded-md p-1 text-white/35 transition-colors hover:bg-white/10 hover:text-white/80"
                                title="Copy full output path"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          {isRefreshBlocked && (
                            <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[10px] font-mono uppercase tracking-widest text-amber-100/75">Link expired</div>
                                  <div className="mt-1 text-xs text-amber-50">Refresh URL to keep your progress.</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openRefreshUrlModal(download)}
                                  className="rounded-lg border border-amber-300/30 px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest text-amber-100 transition-colors hover:border-amber-200/50 hover:bg-amber-200/10"
                                >
                                  Refresh Link
                                </button>
                              </div>
                              {isPopupSurface && (
                                <div className="mt-2 text-[10px] text-amber-100/70">Right-click row to pull current tab URL.</div>
                              )}
                            </div>
                          )}
                          {download.status === 'error' && !isRefreshBlocked && (download.error || download.error_code || download.last_attempt_at) && (
                            <div className="mt-0.5">
                              {download.error && <div className="text-xs text-red-400 truncate" title={download.error}>{download.error}</div>}
                              {(download.error_code || download.last_attempt_at) && (
                                <div className="mt-1 hidden rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[10px] font-mono text-red-200 shadow-lg group-hover:block">
                                  {download.error_code && <div>Code: {download.error_code}</div>}
                                  {download.last_attempt_at && <div>Last Attempt: {formatAttemptTimestamp(download.last_attempt_at)}</div>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="data-value">{formatSize((download as any).total_size ?? download.size ?? 0)}</div>
                        <div className="space-y-2 pr-4">
                          <div className="flex justify-between text-[10px] uppercase font-mono tracking-widest font-medium">
                            <span className={statusClass}>
                              {download.status}
                            </span>
                            <span className="text-white/50">{typeof download.progress === 'number' ? Math.round(download.progress) : download.progress}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden shadow-inner">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${download.progress}%` }}
                              className={`h-full rounded-full ${progressClass}`}
                            />
                          </div>
                        </div>
                        <div className="data-value">{formatDownloadSpeed(download)}</div>
                        <div className="relative flex gap-2">
                          <button
                            type="button"
                            onClick={() => void revealDownloadInFolder(download.id)}
                            disabled={!download.output_path}
                            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Reveal in folder"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openDownloadFile(download.id)}
                            disabled={download.status !== 'finished'}
                            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Open file"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void togglePlayPause(download)}
                            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all"
                            title={isActiveDownload ? 'Pause' : isRefreshBlocked ? 'Refresh link' : download.status === 'error' ? 'Retry' : 'Resume'}
                          >
                            {isActiveDownload ? (
                              <Pause className="w-3.5 h-3.5" />
                            ) : isRefreshBlocked ? (
                              <RefreshCw className="w-3.5 h-3.5 text-amber-300" />
                            ) : download.status === 'error' ? (
                              <RefreshCw className="w-3.5 h-3.5 text-red-500" />
                            ) : (
                              <Play className="w-3.5 h-3.5 pl-[1px]" />
                            )}
                          </button>
                    <button
                      type="button"
                      onClick={() => setRemovalTarget((current) => current?.id === download.id ? null : { id: download.id, status: download.status })}
                      className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all"
                      title="Remove download"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    {removalTarget?.id === download.id && (
                      <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-white/10 bg-[#111111] p-3 shadow-2xl">
                        <p className="text-[11px] font-medium text-white/85">Remove this download?</p>
                        <p className="mt-1 text-[10px] text-white/45">List entry removed now. Delete file also removes any partial data.</p>
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => void removeDownload(download.id, false)}
                            className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-[11px] text-white/75 transition-colors hover:border-white/20 hover:text-white"
                          >
                            Remove from list
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeDownload(download.id, true)}
                            className={`w-full rounded-lg px-3 py-2 text-left text-[11px] transition-colors ${removalTarget.status === 'finished' ? 'bg-red-500/15 text-red-200 hover:bg-red-500/20' : 'border border-red-500/25 text-red-200 hover:bg-red-500/10'}`}
                          >
                            Remove from list and delete file
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemovalTarget(null)}
                            className="w-full rounded-lg px-3 py-2 text-left text-[11px] text-white/45 transition-colors hover:bg-white/5 hover:text-white/75"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </AnimatePresence>
            </>
          )}
        </div>

        <footer className="min-h-8 border-t border-white/5 bg-[#0A0A0A] text-white/40 px-6 py-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest gap-4 flex-wrap">
          <div>
            Native Host:{' '}
            <span className={hostStatus.connected ? 'text-green-400' : 'text-amber-300'}>
              {hostStatus.connected ? 'Connected' : 'Disconnected'} ({hostStatus.protocolVersion})
            </span>
          </div>
          <div>Queue: Default (Parallel x{segmentsCount})</div>
          {isPopupSurface && permissionStatus.canRequestCurrentOrigin && !permissionStatus.currentOriginGranted && !permissionStatus.hasAllUrlsPermission && (
            <button
              type="button"
              onClick={() => void requestCurrentOriginPermission()}
              className="max-w-65 truncate rounded-md border border-white/10 px-2 py-1 text-white/70 transition-colors hover:border-white/20 hover:text-white"
              title={`Grant access to ${permissionStatus.currentOrigin}`}
            >
              Grant access to {permissionStatus.currentOrigin}
            </button>
          )}
          <div>Active Connections: {activeConnections}</div>
        </footer>
      </main>

    <AnimatePresence>
      {refreshContextMenu && (() => {
        const refreshTarget = downloads.find((download) => download.id === refreshContextMenu.id);
        if (!refreshTarget) {
          return null;
        }
        return (
          <div className="fixed inset-0 z-40" onClick={() => setRefreshContextMenu(null)} onContextMenu={(event) => { event.preventDefault(); setRefreshContextMenu(null); }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              onClick={(event) => event.stopPropagation()}
              className="absolute min-w-64 rounded-xl border border-white/10 bg-[#111111] p-2 shadow-2xl"
              style={{ left: refreshContextMenu.x, top: refreshContextMenu.y }}
            >
              <button
                type="button"
                onClick={() => void loadCurrentTabUrlIntoRefreshModal(refreshTarget)}
                disabled={!isExtensionRuntimeAvailable()}
                className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-mono uppercase tracking-widest text-white/80 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Refresh URL From Current Tab
              </button>
            </motion.div>
          </div>
        );
      })()}
    </AnimatePresence>

    <AnimatePresence>
      {refreshUrlDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeRefreshUrlModal} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[#141414] p-8 shadow-2xl"
          >
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <RefreshCw className="h-5 w-5 text-amber-300" /> Refresh Download Link
            </h2>
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-amber-100/75">Expired Link</div>
                <div className="mt-2 text-sm font-medium text-amber-50">{refreshUrlDialog.label}</div>
                <p className="mt-2 text-xs leading-6 text-amber-100/80">
                  Paste fresh signed URL. Host keeps completed bytes when size and validators still match.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-white/50">New URL</label>
                <input
                  autoFocus
                  type="text"
                  value={refreshUrlInput}
                  onChange={(event) => setRefreshUrlInput(event.target.value)}
                  placeholder="https://example.com/signed/file.bin"
                  className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] px-4 py-3 font-mono text-[13px] text-white focus:border-white/30 focus:outline-none"
                />
                {refreshUrlDialog.currentUrl && (
                  <p className="mt-2 truncate text-[10px] font-mono text-white/35" title={refreshUrlDialog.currentUrl}>
                    Current stored URL: {refreshUrlDialog.currentUrl}
                  </p>
                )}
              </div>

              {refreshUrlError && (
                <div className={`rounded-xl border px-3 py-3 text-sm ${refreshUrlMismatch ? 'border-amber-400/20 bg-amber-400/10 text-amber-100' : 'border-red-500/20 bg-red-500/10 text-red-200'}`}>
                  <div className="font-medium">{refreshUrlMismatch ? formatRefreshIssueTitle(refreshUrlMismatch.code) : 'Refresh failed'}</div>
                  <div className="mt-1 text-xs leading-6">{refreshUrlError}</div>
                </div>
              )}

              {refreshUrlMismatch?.details && Object.entries(refreshUrlMismatch.details).length > 0 && (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">Mismatch Details</div>
                  <div className="mt-3 grid gap-2 text-xs text-white/75">
                    {Object.entries(refreshUrlMismatch.details).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-4">
                        <span className="text-white/45">{formatRefreshDetailLabel(key)}</span>
                        <span className="max-w-[60%] truncate font-mono text-right text-white/90" title={formatRefreshDetailValue(key, value)}>
                          {formatRefreshDetailValue(key, value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <button onClick={closeRefreshUrlModal} className="rounded-xl border border-white/10 px-5 py-3 text-white/70 transition-colors hover:bg-white/5">
                  Cancel
                </button>
                {isExtensionRuntimeAvailable() && (
                  <button
                    type="button"
                    onClick={() => {
                      const download = downloads.find((candidate) => candidate.id === refreshUrlDialog.id);
                      if (download) {
                        void loadCurrentTabUrlIntoRefreshModal(download);
                      }
                    }}
                    disabled={isLoadingCurrentTabUrl || isRefreshingUrl}
                    className="rounded-xl border border-white/10 px-5 py-3 text-white/75 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isLoadingCurrentTabUrl ? 'Pulling Current Tab...' : 'Use Current Tab URL'}
                  </button>
                )}
                {refreshUrlMismatch && canForceRefreshWithoutValidators(refreshUrlMismatch.code) && (
                  <button
                    type="button"
                    onClick={() => void submitRefreshDownloadUrl({ force: true })}
                    disabled={isRefreshingUrl}
                    className="rounded-xl border border-amber-300/30 px-5 py-3 text-amber-100 transition-colors hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continue Anyway
                  </button>
                )}
                {refreshUrlMismatch && canRestartRefreshFromScratch(refreshUrlMismatch.code) && (
                  <button
                    type="button"
                    onClick={() => void submitRefreshDownloadUrl({ force: true, restartFromScratch: true })}
                    disabled={isRefreshingUrl}
                    className="rounded-xl border border-red-500/30 px-5 py-3 text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Restart From Scratch
                  </button>
                )}
                <button
                  onClick={() => void submitRefreshDownloadUrl()}
                  disabled={isRefreshingUrl}
                  className="flex-1 rounded-xl bg-white px-5 py-3 font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
                >
                  {isRefreshingUrl ? 'Refreshing Link...' : 'Refresh Link'}
                </button>
              </div>

              {isPopupSurface && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-white/35">
                  Popup shortcut: right-click expired row to pull active-tab URL.
                </p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={resetAddDownloadForm} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-[#141414] border border-white/10 p-8 rounded-2xl shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
                <Plus className="w-5 h-5 text-white/50" /> Add New Download
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-mono tracking-widest text-white/50 mb-2 block">Enter URL</label>
                  <input
                    autoFocus
                    type="text"
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    placeholder="https://example.com/file.iso"
                    className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
                  />
                  {normalizedUrlInput && !canAddDownload && (
                    <p className="mt-2 text-[11px] text-amber-200">Enter valid http(s) URL before starting download.</p>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <label className="text-[13px] font-medium tracking-wide text-white/90">Scheduled Window</label>
                      <p className="text-[10px] uppercase font-mono mt-1 tracking-wider text-white/40">Pause outside window and autoresume when it opens</p>
                    </div>
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scheduleEnabled}
                        onChange={(event) => setScheduleEnabled(event.target.checked)}
                        className="sr-only peer"
                      />
                      <span className="relative h-6 w-11 rounded-full bg-white/10 transition-colors peer-checked:bg-white/80">
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-transform ${scheduleEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </span>
                    </label>
                  </div>

                  {scheduleEnabled && (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-[13px] font-medium tracking-wide text-white/90">Start Hour</label>
                          <input
                            type="number"
                            min="0"
                            max="23"
                            step="1"
                            value={scheduleStartHour}
                            onChange={(event) => setScheduleStartHour(normalizeScheduleHour(Number.parseInt(event.target.value, 10)))}
                            className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[13px] font-medium tracking-wide text-white/90">End Hour</label>
                          <input
                            type="number"
                            min="0"
                            max="23"
                            step="1"
                            value={scheduleEndHour}
                            onChange={(event) => setScheduleEndHour(normalizeScheduleHour(Number.parseInt(event.target.value, 10)))}
                            className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[13px] font-medium tracking-wide text-white/90">Days</label>
                        <div className="grid grid-cols-7 gap-2">
                          {WEEKDAY_OPTIONS.map((option) => {
                            const active = scheduleDays.includes(option.value);
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => toggleScheduleDay(option.value)}
                                className={active
                                  ? 'rounded-xl border border-white/40 bg-white text-black px-3 py-2 text-[11px] font-mono uppercase tracking-widest transition-colors'
                                  : 'rounded-xl border border-white/10 bg-[#0A0A0A] text-white/60 px-3 py-2 text-[11px] font-mono uppercase tracking-widest transition-colors hover:border-white/30 hover:text-white/90'}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-4">
                  <button onClick={resetAddDownloadForm} className="px-6 py-3 border border-white/10 text-white/70 rounded-xl font-medium hover:bg-white/5 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={() => void addDownload()}
                    disabled={!canAddDownload}
                    className="flex-1 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors shadow-sm disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40 disabled:hover:bg-white/20"
                  >
                    Start Download
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsSettingsOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#141414] border border-white/10 p-8 rounded-2xl shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
                <Settings className="w-5 h-5 text-white/50" /> Settings
              </h2>
              <div className="space-y-6">
                {settingsSections}
                {settingsActions}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarItem({ icon, label, active = false, count, onClick }: { icon: ReactNode; label: string; active?: boolean; count?: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all group ${active ? 'bg-white/10 text-white shadow-sm' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
    >
      <div className="flex items-center gap-3">
        <span className={`${active ? 'text-white' : 'text-white/40 group-hover:text-white/80'}`}>{icon}</span>
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      {count !== undefined && (
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ToolbarButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-1.5 border border-white/10 bg-white/5 rounded-lg text-sm font-medium hover:bg-white/10 transition-all text-white/80 shadow-sm">
      {icon} <span className="hidden sm:inline">{label}</span>
    </button>
  );
}