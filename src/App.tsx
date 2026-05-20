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
  Github,
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

type AppSurface = 'dashboard' | 'popup' | 'options';

interface AppProps {
  surface?: AppSurface;
}

interface DownloadItem {
  id: number | string;
  name?: string;
  filename?: string;
  output_path?: string;
  size?: string;
  total_size?: number;
  progress: number;
  speed: string;
  status: 'downloading' | 'paused' | 'finished' | 'queued' | 'error' | 'muxing';
  type?: string;
  error?: string;
  error_code?: string;
  last_attempt_at?: string;
}

interface InterceptionSettings {
  enabled: boolean;
  extensions: string[];
  minFileSizeMB: number;
  allowDomains: string[];
  blockDomains: string[];
  scheduleEnabled: boolean;
  scheduleStartHour: number;
  scheduleEndHour: number;
  scheduleDays: number[];
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
  const [downloadDirInput, setDownloadDirInput] = useState(DEFAULT_HOST_SETTINGS.downloadDir);
  const [downloadDirError, setDownloadDirError] = useState<string | null>(null);
  // TODO: extend single-item removal flow to multi-select actions.
  const [removalTarget, setRemovalTarget] = useState<{ id: number | string; status: DownloadItem['status'] } | null>(null);
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

  const refreshDownloads = async () => {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'GET_DOWNLOADS' });
      return;
    }

    const previewDownloads = await fetch('/api/downloads').then((response) => response.json());
    setDownloads(previewDownloads);
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

  useEffect(() => {
    void loadInterceptionSettings();
    void loadHostSettings();
  }, []);

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
        }
      };

      runtime.onMessage.addListener(listener);
      void refreshDownloads();
      void refreshHostStatus();
      void refreshHostStats();

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
    if (!urlInput) {
      return;
    }

    const schedule = buildDownloadSchedule();

    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({
        type: 'START_DOWNLOAD',
        url: urlInput,
        segments: segmentsCount,
        schedule,
      });
      void refreshHostStats();
    } else {
      const response = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput, segments: segmentsCount, schedule }),
      });
      const newDownload = await response.json();
      setDownloads([...downloads, newDownload]);
    }

    resetAddDownloadForm();
  };

  const togglePlayPause = async (id: number | string, currentStatus: string) => {
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
          ? { ...download, status: currentStatus === 'downloading' || currentStatus === 'muxing' ? 'paused' : 'downloading' }
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

  const commitDownloadDir = async () => {
    const nextSettings = {
      ...hostSettings,
      downloadDir: downloadDirInput.trim(),
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

  const openDownloadDirPickerFallback = () => {
    setDownloadDirError('Directory picker not wired yet. Type absolute path manually.');
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
                onClick={openDownloadDirPickerFallback}
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

            <aside className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-xl space-y-4">
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
            </aside>
          </div>
        </div>
      </div>
    );
  }

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
          <SidebarItem icon={<Github className="w-4 h-4" />} label="Source Code" />
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

        <div className="flex-1 overflow-auto relative">
          <div className="grid grid-cols-[40px_1fr_120px_180px_120px_100px] gap-4 px-6 py-3 sticky top-0 border-b border-white/5 bg-[#0A0A0A]/90 backdrop-blur-xl z-10">
            <div className="col-header">ID</div>
            <div className="col-header">File Name</div>
            <div className="col-header">Size</div>
            <div className="col-header">Status / Progress</div>
            <div className="col-header">Speed</div>
            <div className="col-header">Actions</div>
          </div>

          <AnimatePresence>
            <div className="p-3 space-y-1">
              {filteredDownloads.map((download) => (
                <motion.div
                  key={download.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="data-row grid grid-cols-[40px_1fr_120px_180px_120px_100px] gap-4 px-3 py-3 items-center group"
                >
                  <div className="data-value opacity-40">{typeof download.id === 'number' ? download.id.toString().padStart(2, '0') : download.id.substring(0, 4)}</div>
                  <div className="flex flex-col min-w-0 pr-4">
                    <div className="font-medium truncate text-[13px] text-white/90">{download.name || download.filename}</div>
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
                    {download.status === 'error' && (download.error || download.error_code || download.last_attempt_at) && (
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
                      <span className={download.status === 'downloading' ? 'text-blue-400' : download.status === 'error' ? 'text-red-400' : 'text-white/40'}>
                        {download.status}
                      </span>
                      <span className="text-white/50">{typeof download.progress === 'number' ? Math.round(download.progress) : download.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden shadow-inner">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${download.progress}%` }}
                        className={`h-full rounded-full ${download.status === 'finished' ? 'bg-green-500' : download.status === 'error' ? 'bg-red-500' : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'}`}
                      />
                    </div>
                  </div>
                  <div className="data-value">{download.speed}</div>
                  <div className="relative flex gap-2">
                    <button
                      onClick={() => void togglePlayPause(download.id, download.status)}
                      className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all"
                      title={download.status === 'downloading' || download.status === 'queued' || download.status === 'muxing' ? 'Pause' : download.status === 'error' ? 'Retry' : 'Resume'}
                    >
                      {download.status === 'downloading' || download.status === 'queued' || download.status === 'muxing' ? (
                        <Pause className="w-3.5 h-3.5" />
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
              ))}
            </div>
          </AnimatePresence>
        </div>

        <footer className="h-8 border-t border-white/5 bg-[#0A0A0A] text-white/40 px-6 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest gap-4">
          <div>
            Native Host:{' '}
            <span className={hostStatus.connected ? 'text-green-400' : 'text-amber-300'}>
              {hostStatus.connected ? 'Connected' : 'Disconnected'} ({hostStatus.protocolVersion})
            </span>
          </div>
          <div>Queue: Default (Parallel x{segmentsCount})</div>
          <div>Active Connections: {activeConnections}</div>
        </footer>
      </main>

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
                  <button onClick={() => void addDownload()} className="flex-1 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors shadow-sm">
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