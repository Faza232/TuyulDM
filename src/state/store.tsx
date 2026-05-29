import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { bridge } from './bridge';
import type { PushMessage } from './bridge';
import {
  DEFAULT_HOST_SETTINGS, DEFAULT_HOST_STATS, DEFAULT_HOST_STATUS,
  DEFAULT_INTERCEPTION_SETTINGS, DEFAULT_PERMISSION_STATUS,
  normalizeDetectedStreamList, normalizeHostSettings, normalizeHostStats,
  normalizeHostStatus, normalizeInterceptionSettings, normalizePermissionStatus,
} from './normalize';
import type {
  DownloadItem, DetectedStreamItem, HostSettings, HostStats, HostStatus,
  InterceptionSettings, PermissionStatus, DownloadSchedulePayload, RefreshUrlResponse,
} from './types';
import { useToasts } from './toast';

const HOST_SETTINGS_STORAGE_KEY = 'tuyuldm_host_settings';
const INTERCEPTION_STORAGE_KEY = 'tuyuldm_interception_settings';

interface StoreValue {
  // data
  downloads: DownloadItem[];
  detectedStreams: DetectedStreamItem[];
  interception: InterceptionSettings;
  hostSettings: HostSettings;
  hostStatus: HostStatus;
  hostStats: HostStats;
  permission: PermissionStatus;
  isExtension: boolean;
  grabberNotice: string | null;
  isScanningPage: boolean;
  // download actions
  startDownload: (url: string, segments: number, schedule?: DownloadSchedulePayload) => Promise<void>;
  pause: (id: number | string) => Promise<void>;
  resume: (id: number | string) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  remove: (id: number | string, deleteFile: boolean) => Promise<void>;
  refreshUrl: (id: number | string, url: string, opts?: { force?: boolean; restartFromScratch?: boolean }) => Promise<RefreshUrlResponse | undefined>;
  openFile: (id: number | string) => Promise<void>;
  revealInFolder: (id: number | string) => Promise<void>;
  // detection actions
  scanPage: () => Promise<void>;
  refreshDetectedStreams: () => Promise<void>;
  startDetectedMediaDownload: (id: string, selectedVariantId: string) => Promise<{ error?: string } | undefined>;
  reviewDetectedStream: (stream: DetectedStreamItem) => Promise<void>;
  // settings actions
  persistInterception: (settings: InterceptionSettings) => Promise<void>;
  persistHostSettings: (settings: Partial<HostSettings>) => Promise<{ error?: string } | undefined>;
  pickDownloadDirectory: () => Promise<void>;
  // permissions
  requestAllUrlsPermission: () => Promise<void>;
  requestCurrentTabPermission: () => Promise<void>;
  dismissPermissionOnboarding: () => Promise<void>;
  revokeGrantedPermission: (origin: string) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StateProvider({ children }: { children: ReactNode }) {
  const isExtension = bridge.isExtension();
  const { push } = useToasts();

  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [detectedStreams, setDetectedStreams] = useState<DetectedStreamItem[]>([]);
  const [interception, setInterception] = useState<InterceptionSettings>(DEFAULT_INTERCEPTION_SETTINGS);
  const [hostSettings, setHostSettings] = useState<HostSettings>(DEFAULT_HOST_SETTINGS);
  const [hostStatus, setHostStatus] = useState<HostStatus>(DEFAULT_HOST_STATUS);
  const [hostStats, setHostStats] = useState<HostStats>(DEFAULT_HOST_STATS);
  const [permission, setPermission] = useState<PermissionStatus>(DEFAULT_PERMISSION_STATUS);
  const [grabberNotice, setGrabberNotice] = useState<string | null>(null);
  const [isScanningPage, setIsScanningPage] = useState(false);

  const pushRef = useRef(push);
  pushRef.current = push;

  // ---- loaders ----
  const refreshDownloads = useCallback(async () => {
    const list = await bridge.getDownloads();
    if (Array.isArray(list)) setDownloads(list);
  }, []);

  const refreshHostStatus = useCallback(async () => {
    const status = await bridge.getHostStatus();
    setHostStatus(normalizeHostStatus(status));
  }, []);

  const refreshHostStats = useCallback(async () => {
    const r = await bridge.getHostStats();
    setHostStats(normalizeHostStats(r?.stats));
    if (r?.status) setHostStatus(normalizeHostStatus(r.status));
  }, []);

  const refreshPermissionStatus = useCallback(async () => {
    if (!isExtension) { setPermission(DEFAULT_PERMISSION_STATUS); return; }
    const r = await bridge.getPermissionStatus();
    if (r?.error) return;
    setPermission(normalizePermissionStatus(r?.status));
  }, [isExtension]);

  const refreshDetectedStreams = useCallback(async () => {
    if (!isExtension) { setDetectedStreams([]); return; }
    const r = await bridge.getDetectedStreams();
    if (r?.error) { setGrabberNotice(r.error); return; }
    setDetectedStreams(normalizeDetectedStreamList(r?.streams));
    setGrabberNotice(null);
  }, [isExtension]);

  // ---- settings load ----
  useEffect(() => {
    void (async () => {
      if (isExtension) {
        const ix = await bridge.getInterceptionSettings();
        if (ix?.settings) setInterception(normalizeInterceptionSettings(ix.settings));
        const hs = await bridge.getHostSettings();
        if (hs?.settings) setHostSettings(normalizeHostSettings(hs.settings));
        return;
      }
      const savedIx = localStorage.getItem(INTERCEPTION_STORAGE_KEY);
      if (savedIx) { try { setInterception(normalizeInterceptionSettings(JSON.parse(savedIx))); } catch { localStorage.removeItem(INTERCEPTION_STORAGE_KEY); } }
      const savedHs = localStorage.getItem(HOST_SETTINGS_STORAGE_KEY);
      if (savedHs) { try { setHostSettings(normalizeHostSettings(JSON.parse(savedHs))); } catch { localStorage.removeItem(HOST_SETTINGS_STORAGE_KEY); } }
    })();
  }, [isExtension]);

  // ---- push subscription + polling ----
  useEffect(() => {
    if (isExtension) {
      const unsub = bridge.subscribe((message: PushMessage) => {
        if (message.type === 'PROGRESS_UPDATE') {
          setDownloads((prev) => {
            const exists = prev.find((d) => d.id === message.payload.id);
            if (exists) return prev.map((d) => (d.id === message.payload.id ? { ...d, ...message.payload } : d));
            return [...prev, message.payload];
          });
        } else if (message.type === 'LIST_UPDATE') {
          setDownloads(message.payload || []);
        } else if (message.type === 'INTERCEPTION_SETTINGS_UPDATED') {
          setInterception(normalizeInterceptionSettings(message.payload || {}));
        } else if (message.type === 'HOST_SETTINGS_UPDATED') {
          setHostSettings(normalizeHostSettings(message.payload || {}));
        } else if (message.type === 'HOST_STATUS') {
          setHostStatus(normalizeHostStatus(message.payload));
        } else if (message.type === 'PERMISSIONS_UPDATED') {
          setPermission(normalizePermissionStatus(message.payload));
        } else if (message.type === 'DETECTED_STREAMS_UPDATED') {
          void refreshDetectedStreams();
        }
      });

      void refreshDownloads();
      void refreshHostStatus();
      void refreshHostStats();
      void refreshPermissionStatus();
      void refreshDetectedStreams();
      const interval = window.setInterval(() => { void refreshHostStats(); }, 2000);
      return () => { window.clearInterval(interval); unsub(); };
    }

    // dev-server fallback: poll
    const tick = async () => {
      const list = await bridge.getDownloads();
      if (Array.isArray(list)) setDownloads(list);
      const r = await bridge.getHostStats();
      if (r?.stats) setHostStats(normalizeHostStats(r.stats));
      const status = await bridge.getHostStatus();
      if (status) setHostStatus(normalizeHostStatus(status));
    };
    void tick();
    const interval = window.setInterval(() => { void tick(); }, 2000);
    return () => window.clearInterval(interval);
  }, [isExtension, refreshDownloads, refreshHostStatus, refreshHostStats, refreshPermissionStatus, refreshDetectedStreams]);

  // ---- download actions ----
  const startDownload = useCallback(async (url: string, segments: number, schedule?: DownloadSchedulePayload) => {
    const created = await bridge.startDownload(url, segments, schedule);
    if (!isExtension && created) setDownloads((prev) => [...prev, created]);
    void refreshHostStats();
  }, [isExtension, refreshHostStats]);

  const pause = useCallback(async (id: number | string) => {
    setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, status: 'paused', speed: '0 B/s', speed_bytes_per_second: 0 } : d)));
    await bridge.pause(id);
    void refreshHostStats();
  }, [refreshHostStats]);

  const resume = useCallback(async (id: number | string) => {
    setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, status: 'downloading' } : d)));
    await bridge.resume(id);
    void refreshHostStats();
  }, [refreshHostStats]);

  const pauseAll = useCallback(async () => { await bridge.pauseAll(); void refreshDownloads(); void refreshHostStats(); }, [refreshDownloads, refreshHostStats]);
  const resumeAll = useCallback(async () => { await bridge.resumeAll(); void refreshDownloads(); void refreshHostStats(); }, [refreshDownloads, refreshHostStats]);

  const remove = useCallback(async (id: number | string, deleteFile: boolean) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
    const r = await bridge.remove(id, deleteFile);
    if (r?.error) pushRef.current({ tone: 'danger', title: 'Remove failed', body: r.error });
    void refreshDownloads();
    void refreshHostStats();
  }, [refreshDownloads, refreshHostStats]);

  const refreshUrl = useCallback(async (id: number | string, url: string, opts?: { force?: boolean; restartFromScratch?: boolean }) => {
    const r = await bridge.refreshUrl(id, url, opts);
    if (!r?.error) { void refreshDownloads(); void refreshHostStats(); }
    return r;
  }, [refreshDownloads, refreshHostStats]);

  const openFile = useCallback(async (id: number | string) => {
    const r = await bridge.openFile(id);
    if (r?.error) pushRef.current({ tone: 'danger', title: 'Could not open file', body: r.error });
  }, []);

  const revealInFolder = useCallback(async (id: number | string) => {
    const r = await bridge.revealInFolder(id);
    if (r?.error) pushRef.current({ tone: 'danger', title: 'Could not open folder', body: r.error });
  }, []);

  // ---- detection actions ----
  const scanPage = useCallback(async () => {
    if (!isExtension) { setGrabberNotice('Scan works only inside the extension.'); return; }
    setIsScanningPage(true);
    setGrabberNotice(null);
    const r = await bridge.scanPage();
    setIsScanningPage(false);
    if (r?.error) { setGrabberNotice(r.error); return; }
    const streams = normalizeDetectedStreamList(r?.streams);
    setDetectedStreams(streams);
    setGrabberNotice(streams.length > 0 ? null : 'No media URLs found on current page.');
  }, [isExtension]);

  const startDetectedMediaDownload = useCallback(async (id: string, selectedVariantId: string) => {
    if (!isExtension) { setGrabberNotice('Video grabber requires the extension.'); return { error: 'no_runtime' }; }
    const r = await bridge.startDetectedMediaDownload(id, selectedVariantId);
    if (r?.error) { setGrabberNotice(r.error); return r; }
    void refreshDownloads();
    void refreshHostStats();
    return r;
  }, [isExtension, refreshDownloads, refreshHostStats]);

  const reviewDetectedStream = useCallback(async (stream: DetectedStreamItem) => {
    if (!isExtension) { setGrabberNotice('Overlay review requires the extension.'); return; }
    if (!stream.manifestType) { setGrabberNotice('Overlay review works only for HLS/DASH manifests.'); return; }
    const r = await bridge.showDetectedStreamOverlay(stream.url, stream.manifestType);
    if (r?.error) { setGrabberNotice(r.error); return; }
    setGrabberNotice('Overlay sent to active tab.');
  }, [isExtension]);

  // ---- settings actions ----
  const persistInterception = useCallback(async (settings: InterceptionSettings) => {
    const normalized = normalizeInterceptionSettings(settings);
    setInterception(normalized);
    if (isExtension) {
      const r = await bridge.updateInterceptionSettings(normalized);
      if (r?.settings) setInterception(normalizeInterceptionSettings(r.settings));
      return;
    }
    localStorage.setItem(INTERCEPTION_STORAGE_KEY, JSON.stringify(normalized));
  }, [isExtension]);

  const persistHostSettings = useCallback(async (settings: Partial<HostSettings>): Promise<{ error?: string } | undefined> => {
    const normalized = normalizeHostSettings({ ...hostSettings, ...settings });
    setHostSettings(normalized);
    if (isExtension) {
      const r = await bridge.updateHostSettings(normalized);
      if (r?.error) { pushRef.current({ tone: 'danger', title: 'Save failed', body: r.error }); return { error: r.error }; }
      if (r?.settings) setHostSettings(normalizeHostSettings(r.settings));
      return undefined;
    }
    localStorage.setItem(HOST_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    return undefined;
  }, [hostSettings, isExtension]);

  const pickDownloadDirectory = useCallback(async () => {
    if (!isExtension) { pushRef.current({ tone: 'warning', title: 'Picker unavailable', body: 'Directory picker needs the native host. Type an absolute path.' }); return; }
    const r = await bridge.pickDownloadDirectory(hostSettings.downloadDir);
    if (r?.error) { pushRef.current({ tone: 'danger', title: 'Picker failed', body: r.error }); return; }
    if (r?.path) await persistHostSettings({ downloadDir: r.path });
  }, [isExtension, hostSettings.downloadDir, persistHostSettings]);

  // ---- permissions ----
  const requestAllUrlsPermission = useCallback(async () => {
    const r = await bridge.requestAllUrlsPermission();
    if (r?.status) setPermission(normalizePermissionStatus(r.status));
  }, []);
  const requestCurrentTabPermission = useCallback(async () => {
    const r = await bridge.requestCurrentTabPermission();
    if (r?.status) setPermission(normalizePermissionStatus(r.status));
  }, []);
  const dismissPermissionOnboarding = useCallback(async () => {
    const r = await bridge.dismissPermissionOnboarding();
    if (r?.status) setPermission(normalizePermissionStatus(r.status));
  }, []);
  const revokeGrantedPermission = useCallback(async (origin: string) => {
    const r = await bridge.revokeGrantedPermission(origin);
    if (r?.status) setPermission(normalizePermissionStatus(r.status));
  }, []);

  const value = useMemo<StoreValue>(() => ({
    downloads, detectedStreams, interception, hostSettings, hostStatus, hostStats, permission,
    isExtension, grabberNotice, isScanningPage,
    startDownload, pause, resume, pauseAll, resumeAll, remove, refreshUrl, openFile, revealInFolder,
    scanPage, refreshDetectedStreams, startDetectedMediaDownload, reviewDetectedStream,
    persistInterception, persistHostSettings, pickDownloadDirectory,
    requestAllUrlsPermission, requestCurrentTabPermission, dismissPermissionOnboarding, revokeGrantedPermission,
  }), [
    downloads, detectedStreams, interception, hostSettings, hostStatus, hostStats, permission,
    isExtension, grabberNotice, isScanningPage,
    startDownload, pause, resume, pauseAll, resumeAll, remove, refreshUrl, openFile, revealInFolder,
    scanPage, refreshDetectedStreams, startDetectedMediaDownload, reviewDetectedStream,
    persistInterception, persistHostSettings, pickDownloadDirectory,
    requestAllUrlsPermission, requestCurrentTabPermission, dismissPermissionOnboarding, revokeGrantedPermission,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StateProvider');
  return ctx;
}

// Plan-named hook slices. All read from the single StateProvider so the push
// subscription and polling stay shared.
export function useDownloads() {
  const s = useStore();
  return {
    downloads: s.downloads,
    startDownload: s.startDownload,
    pause: s.pause,
    resume: s.resume,
    pauseAll: s.pauseAll,
    resumeAll: s.resumeAll,
    remove: s.remove,
    refreshUrl: s.refreshUrl,
    openFile: s.openFile,
    revealInFolder: s.revealInFolder,
  };
}

export function useDetection() {
  const s = useStore();
  return {
    detectedStreams: s.detectedStreams,
    grabberNotice: s.grabberNotice,
    isScanningPage: s.isScanningPage,
    scanPage: s.scanPage,
    refreshDetectedStreams: s.refreshDetectedStreams,
    startDetectedMediaDownload: s.startDetectedMediaDownload,
    reviewDetectedStream: s.reviewDetectedStream,
  };
}

export function useSettings() {
  const s = useStore();
  return {
    interception: s.interception,
    hostSettings: s.hostSettings,
    persistInterception: s.persistInterception,
    persistHostSettings: s.persistHostSettings,
    pickDownloadDirectory: s.pickDownloadDirectory,
  };
}

export function useSystem() {
  const s = useStore();
  return {
    hostStatus: s.hostStatus,
    hostStats: s.hostStats,
    permission: s.permission,
    isExtension: s.isExtension,
    openLogs: () => bridge.openLogs(),
    requestAllUrlsPermission: s.requestAllUrlsPermission,
    requestCurrentTabPermission: s.requestCurrentTabPermission,
    dismissPermissionOnboarding: s.dismissPermissionOnboarding,
    revokeGrantedPermission: s.revokeGrantedPermission,
  };
}
