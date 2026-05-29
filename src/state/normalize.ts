import type {
  InterceptionSettings, HostSettings, HostStatus, HostStats, PermissionStatus,
  DetectedStreamItem,
} from './types';

export const DEFAULT_INTERCEPTION_SETTINGS: InterceptionSettings = {
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

export const DEFAULT_HOST_STATUS: HostStatus = {
  connected: false,
  protocolVersion: 'IPC v1',
  lastError: null,
};

export const DEFAULT_PERMISSION_STATUS: PermissionStatus = {
  currentOrigin: '',
  currentOriginPattern: '',
  currentOriginGranted: false,
  canRequestCurrentOrigin: false,
  hasAllUrlsPermission: false,
  grantedOrigins: [],
  shouldShowOnboarding: false,
};

export const DEFAULT_HOST_STATS: HostStats = {
  globalSpeedBytesPerSecond: 0,
  freeSpaceBytes: 0,
  activeDownloads: 0,
};

export const DEFAULT_HOST_SETTINGS: HostSettings = {
  maxConcurrentDownloads: 3,
  globalThrottleBytesPerSecond: 0,
  perDownloadThrottleBytesPerSecond: 0,
  downloadDir: '',
  logLevel: 'info',
};

export const WEEKDAY_OPTIONS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
] as const;

const DEFAULT_SCHEDULE_DAYS = WEEKDAY_OPTIONS.map((o) => o.value);

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeExtensionRule(value: string) {
  return value.trim().toLowerCase().replace(/^\./, '');
}

export function normalizeDomainRule(value: string) {
  return value.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
}

export function normalizeScheduleHour(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(23, Math.max(0, Math.round(value)));
}

function normalizeScheduleDay(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(6, Math.max(0, Math.round(value)));
}

export function normalizeScheduleDays(values: unknown): number[] {
  if (!Array.isArray(values)) return [...DEFAULT_SCHEDULE_DAYS];
  const normalized = Array.from(
    new Set(values.map((v) => normalizeScheduleDay(Number(v))).filter((v) => Number.isFinite(v))),
  ).sort((a, b) => a - b);
  return normalized.length === 0 ? [...DEFAULT_SCHEDULE_DAYS] : normalized;
}

export function toggleScheduleDayValue(days: number[], day: number) {
  if (days.includes(day)) {
    if (days.length === 1) return days;
    return days.filter((v) => v !== day);
  }
  return [...days, day].sort((a, b) => a - b);
}

export function parseSettingsList(value: string, normalize: (v: string) => string) {
  return uniqueStrings(value.split(/[\n,]/).map(normalize).filter(Boolean));
}

export function formatExtensionRules(values: string[]) {
  return values.map((v) => `.${v}`).join('\n');
}

export function formatDomainRules(values: string[]) {
  return values.join('\n');
}

export function normalizeInterceptionSettings(s: Partial<InterceptionSettings>): InterceptionSettings {
  const minFileSizeMB = Number.isFinite(Number(s.minFileSizeMB))
    ? Math.max(0, Number(s.minFileSizeMB))
    : DEFAULT_INTERCEPTION_SETTINGS.minFileSizeMB;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_INTERCEPTION_SETTINGS.enabled,
    extensions: uniqueStrings((s.extensions ?? DEFAULT_INTERCEPTION_SETTINGS.extensions).map(normalizeExtensionRule)),
    minFileSizeMB,
    allowDomains: uniqueStrings((s.allowDomains ?? DEFAULT_INTERCEPTION_SETTINGS.allowDomains).map(normalizeDomainRule)),
    blockDomains: uniqueStrings((s.blockDomains ?? DEFAULT_INTERCEPTION_SETTINGS.blockDomains).map(normalizeDomainRule)),
    autoShowDetectedStreams: typeof s.autoShowDetectedStreams === 'boolean' ? s.autoShowDetectedStreams : DEFAULT_INTERCEPTION_SETTINGS.autoShowDetectedStreams,
    scheduleEnabled: typeof s.scheduleEnabled === 'boolean' ? s.scheduleEnabled : DEFAULT_INTERCEPTION_SETTINGS.scheduleEnabled,
    scheduleStartHour: normalizeScheduleHour(Number(s.scheduleStartHour ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleStartHour)),
    scheduleEndHour: normalizeScheduleHour(Number(s.scheduleEndHour ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleEndHour)),
    scheduleDays: normalizeScheduleDays(s.scheduleDays ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleDays),
  };
}

export function normalizeHostStatus(s: Partial<HostStatus> | undefined): HostStatus {
  return {
    connected: typeof s?.connected === 'boolean' ? s.connected : DEFAULT_HOST_STATUS.connected,
    protocolVersion: s?.protocolVersion || DEFAULT_HOST_STATUS.protocolVersion,
    lastError: s?.lastError ?? DEFAULT_HOST_STATUS.lastError,
  };
}

function normalizeGrantedOrigins(origins: unknown): string[] {
  if (!Array.isArray(origins)) return [];
  return Array.from(new Set(origins.map((o) => String(o || '').trim()).filter(Boolean))).sort((a, b) => {
    if (a === '<all_urls>') return -1;
    if (b === '<all_urls>') return 1;
    return a.localeCompare(b);
  });
}

export function normalizePermissionStatus(s: Partial<PermissionStatus> | undefined): PermissionStatus {
  return {
    currentOrigin: typeof s?.currentOrigin === 'string' ? s.currentOrigin : DEFAULT_PERMISSION_STATUS.currentOrigin,
    currentOriginPattern: typeof s?.currentOriginPattern === 'string' ? s.currentOriginPattern : DEFAULT_PERMISSION_STATUS.currentOriginPattern,
    currentOriginGranted: typeof s?.currentOriginGranted === 'boolean' ? s.currentOriginGranted : DEFAULT_PERMISSION_STATUS.currentOriginGranted,
    canRequestCurrentOrigin: typeof s?.canRequestCurrentOrigin === 'boolean' ? s.canRequestCurrentOrigin : DEFAULT_PERMISSION_STATUS.canRequestCurrentOrigin,
    hasAllUrlsPermission: typeof s?.hasAllUrlsPermission === 'boolean' ? s.hasAllUrlsPermission : DEFAULT_PERMISSION_STATUS.hasAllUrlsPermission,
    grantedOrigins: normalizeGrantedOrigins(s?.grantedOrigins),
    shouldShowOnboarding: typeof s?.shouldShowOnboarding === 'boolean' ? s.shouldShowOnboarding : DEFAULT_PERMISSION_STATUS.shouldShowOnboarding,
  };
}

export function normalizeHostStats(s: Partial<HostStats> | undefined): HostStats {
  return {
    globalSpeedBytesPerSecond: Number.isFinite(Number(s?.globalSpeedBytesPerSecond)) ? Number(s?.globalSpeedBytesPerSecond) : DEFAULT_HOST_STATS.globalSpeedBytesPerSecond,
    freeSpaceBytes: Number.isFinite(Number(s?.freeSpaceBytes)) ? Number(s?.freeSpaceBytes) : DEFAULT_HOST_STATS.freeSpaceBytes,
    activeDownloads: Number.isFinite(Number(s?.activeDownloads)) ? Number(s?.activeDownloads) : DEFAULT_HOST_STATS.activeDownloads,
  };
}

function normalizeLogLevel(value: unknown) {
  const n = typeof value === 'string' ? value.trim().toLowerCase() : DEFAULT_HOST_SETTINGS.logLevel;
  return ['debug', 'info', 'warn', 'error'].includes(n) ? n : DEFAULT_HOST_SETTINGS.logLevel;
}

export function normalizeHostSettings(s: Partial<HostSettings> | undefined): HostSettings {
  return {
    maxConcurrentDownloads: Number.isFinite(Number(s?.maxConcurrentDownloads)) ? Math.min(32, Math.max(1, Number(s?.maxConcurrentDownloads))) : DEFAULT_HOST_SETTINGS.maxConcurrentDownloads,
    globalThrottleBytesPerSecond: Number.isFinite(Number(s?.globalThrottleBytesPerSecond)) ? Math.max(0, Number(s?.globalThrottleBytesPerSecond)) : DEFAULT_HOST_SETTINGS.globalThrottleBytesPerSecond,
    perDownloadThrottleBytesPerSecond: Number.isFinite(Number(s?.perDownloadThrottleBytesPerSecond)) ? Math.max(0, Number(s?.perDownloadThrottleBytesPerSecond)) : DEFAULT_HOST_SETTINGS.perDownloadThrottleBytesPerSecond,
    downloadDir: typeof s?.downloadDir === 'string' ? s.downloadDir.trim() : DEFAULT_HOST_SETTINGS.downloadDir,
    logLevel: normalizeLogLevel(s?.logLevel),
  };
}

export function normalizeDetectedStreamItem(item: Partial<DetectedStreamItem> | undefined): DetectedStreamItem {
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
          .map((v) => ({
            id: String(v?.id || '').trim(),
            name: typeof v?.name === 'string' ? v.name : '',
            bandwidth: Number.isFinite(Number(v?.bandwidth)) ? Number(v?.bandwidth) : undefined,
            resolution: typeof v?.resolution === 'string' ? v.resolution : '',
            codecs: typeof v?.codecs === 'string' ? v.codecs : '',
            url: typeof v?.url === 'string' ? v.url : '',
          }))
          .filter((v) => !!v.id)
      : undefined,
    selectedVariantId: typeof item?.selectedVariantId === 'string' ? item.selectedVariantId : undefined,
    posterUrl: typeof item?.posterUrl === 'string' ? item.posterUrl : undefined,
    protected: item?.protected === true,
    protectedReason: typeof item?.protectedReason === 'string' ? item.protectedReason : undefined,
  };
}

export function normalizeDetectedStreamList(streams: unknown): DetectedStreamItem[] {
  if (!Array.isArray(streams)) return [];
  return streams.map((s) => normalizeDetectedStreamItem(s));
}
