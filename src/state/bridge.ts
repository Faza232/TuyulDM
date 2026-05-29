// Single typed client for every chrome-runtime / native-host / dev-server call.
// Surfaces and hooks talk to `bridge` only — never sendMessage directly.
import type {
  DownloadItem, DetectedStreamItem, InterceptionSettings, HostSettings,
  HostStatus, HostStats, PermissionStatus, DownloadSchedulePayload, RefreshUrlResponse,
} from './types';

function getChromeRuntime(): any {
  const runtime = (window as any).browser?.runtime ?? (window as any).chrome?.runtime;
  return runtime?.sendMessage ? runtime : null;
}

export function isExtensionRuntimeAvailable(): boolean {
  return !!getChromeRuntime();
}

async function send<T = any>(message: Record<string, unknown>): Promise<T | undefined> {
  const runtime = getChromeRuntime();
  if (!runtime) return undefined;
  return runtime.sendMessage(message);
}

async function devJson<T>(input: string, init?: RequestInit): Promise<T> {
  return fetch(input, init).then((r) => r.json());
}

// Push messages from the background service worker.
export type PushMessage =
  | { type: 'PROGRESS_UPDATE'; payload: DownloadItem }
  | { type: 'LIST_UPDATE'; payload: DownloadItem[] }
  | { type: 'INTERCEPTION_SETTINGS_UPDATED'; payload: Partial<InterceptionSettings> }
  | { type: 'HOST_SETTINGS_UPDATED'; payload: Partial<HostSettings> }
  | { type: 'HOST_STATUS'; payload: Partial<HostStatus> }
  | { type: 'PERMISSIONS_UPDATED'; payload: Partial<PermissionStatus> }
  | { type: 'DETECTED_STREAMS_UPDATED'; payload?: unknown }
  | { type: string; payload?: any };

export function subscribe(listener: (message: PushMessage) => void): () => void {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) return () => {};
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}

export const bridge = {
  isExtension: isExtensionRuntimeAvailable,
  subscribe,

  // ---- downloads ----
  async getDownloads(): Promise<DownloadItem[] | void> {
    if (isExtensionRuntimeAvailable()) {
      await send({ type: 'GET_DOWNLOADS' }); // background replies via LIST_UPDATE push
      return;
    }
    return devJson<DownloadItem[]>('/api/downloads');
  },

  async startDownload(url: string, segments: number, schedule?: DownloadSchedulePayload): Promise<DownloadItem | void> {
    if (isExtensionRuntimeAvailable()) {
      await send({ type: 'START_DOWNLOAD', url, segments, schedule });
      return;
    }
    return devJson<DownloadItem>('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, segments, schedule }),
    });
  },

  async pause(id: number | string): Promise<void> {
    if (isExtensionRuntimeAvailable()) { await send({ type: 'PAUSE_DOWNLOAD', id }); return; }
    await fetch(`/api/downloads/${id}/pause`, { method: 'POST' });
  },

  async resume(id: number | string): Promise<void> {
    if (isExtensionRuntimeAvailable()) { await send({ type: 'RESUME_DOWNLOAD', id }); return; }
    await fetch(`/api/downloads/${id}/resume`, { method: 'POST' });
  },

  async pauseAll(): Promise<void> {
    if (isExtensionRuntimeAvailable()) { await send({ type: 'PAUSE_ALL_DOWNLOADS' }); return; }
    await fetch('/api/downloads/pause-all', { method: 'POST' });
  },

  async resumeAll(): Promise<void> {
    if (isExtensionRuntimeAvailable()) { await send({ type: 'RESUME_ALL_DOWNLOADS' }); return; }
    await fetch('/api/downloads/resume-all', { method: 'POST' });
  },

  async remove(id: number | string, deleteFile: boolean): Promise<{ error?: string } | undefined> {
    if (isExtensionRuntimeAvailable()) return send<{ error?: string }>({ type: 'REMOVE_DOWNLOAD', id, deleteFile });
    await fetch(`/api/downloads/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteFile }),
    });
    return undefined;
  },

  async refreshUrl(id: number | string, url: string, opts: { force?: boolean; restartFromScratch?: boolean } = {}): Promise<RefreshUrlResponse | undefined> {
    const { force = false, restartFromScratch = false } = opts;
    if (isExtensionRuntimeAvailable()) {
      return send<RefreshUrlResponse>({ type: 'REFRESH_DOWNLOAD_URL', id, url, force, restartFromScratch });
    }
    return devJson<RefreshUrlResponse>(`/api/downloads/${id}/refresh-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, force, restartFromScratch }),
    });
  },

  async openFile(id: number | string): Promise<{ error?: string } | undefined> {
    if (isExtensionRuntimeAvailable()) return send<{ error?: string }>({ type: 'OPEN_DOWNLOAD_FILE', id });
    await fetch(`/api/downloads/${id}/open`, { method: 'POST' });
    return undefined;
  },

  async revealInFolder(id: number | string): Promise<{ error?: string } | undefined> {
    if (isExtensionRuntimeAvailable()) return send<{ error?: string }>({ type: 'REVEAL_DOWNLOAD_IN_FOLDER', id });
    await fetch(`/api/downloads/${id}/reveal`, { method: 'POST' });
    return undefined;
  },

  // ---- detection / grabber ----
  async getDetectedStreams(): Promise<{ streams?: DetectedStreamItem[]; error?: string } | undefined> {
    return send<{ streams?: DetectedStreamItem[]; error?: string }>({ type: 'GET_DETECTED_STREAMS' });
  },

  async scanPage(): Promise<{ streams?: DetectedStreamItem[]; error?: string } | undefined> {
    return send<{ streams?: DetectedStreamItem[]; error?: string }>({ type: 'SCAN_PAGE' });
  },

  async startDetectedMediaDownload(id: string, selectedVariantId: string): Promise<{ error?: string } | undefined> {
    return send<{ error?: string }>({ type: 'START_DETECTED_MEDIA_DOWNLOAD', id, selectedVariantId });
  },

  async showDetectedStreamOverlay(url: string, manifestType: string): Promise<{ error?: string } | undefined> {
    return send<{ error?: string }>({ type: 'SHOW_DETECTED_STREAM_OVERLAY', url, manifestType });
  },

  // ---- settings ----
  async getInterceptionSettings(): Promise<{ settings?: InterceptionSettings } | undefined> {
    return send<{ settings?: InterceptionSettings }>({ type: 'GET_INTERCEPTION_SETTINGS' });
  },
  async updateInterceptionSettings(settings: InterceptionSettings): Promise<{ settings?: InterceptionSettings } | undefined> {
    return send<{ settings?: InterceptionSettings }>({ type: 'UPDATE_INTERCEPTION_SETTINGS', settings });
  },
  async getHostSettings(): Promise<{ settings?: HostSettings } | undefined> {
    return send<{ settings?: HostSettings }>({ type: 'GET_HOST_SETTINGS' });
  },
  async updateHostSettings(settings: HostSettings): Promise<{ settings?: HostSettings; error?: string } | undefined> {
    return send<{ settings?: HostSettings; error?: string }>({ type: 'UPDATE_HOST_SETTINGS', settings });
  },
  async pickDownloadDirectory(initial: string): Promise<{ path?: string; error?: string } | undefined> {
    return send<{ path?: string; error?: string }>({ type: 'PICK_DOWNLOAD_DIRECTORY', initial });
  },

  // ---- status / stats ----
  async getHostStatus(): Promise<HostStatus | undefined> {
    if (isExtensionRuntimeAvailable()) {
      const r = await send<{ status?: HostStatus }>({ type: 'GET_HOST_STATUS' });
      return r?.status;
    }
    return devJson<HostStatus>('/api/host-status');
  },
  async getHostStats(): Promise<{ stats?: HostStats; status?: HostStatus } | undefined> {
    if (isExtensionRuntimeAvailable()) {
      return send<{ stats?: HostStats; status?: HostStatus }>({ type: 'GET_HOST_STATS' });
    }
    const stats = await devJson<HostStats>('/api/stats');
    return { stats };
  },

  // ---- permissions ----
  async getPermissionStatus(): Promise<{ status?: PermissionStatus; error?: string } | undefined> {
    return send<{ status?: PermissionStatus; error?: string }>({ type: 'GET_PERMISSION_STATUS' });
  },
  async requestAllUrlsPermission() {
    return send<{ granted?: boolean; status?: PermissionStatus; error?: string }>({ type: 'REQUEST_ALL_URLS_PERMISSION' });
  },
  async requestCurrentTabPermission() {
    return send<{ granted?: boolean; status?: PermissionStatus; error?: string }>({ type: 'REQUEST_CURRENT_TAB_PERMISSION' });
  },
  async dismissPermissionOnboarding() {
    return send<{ status?: PermissionStatus; error?: string }>({ type: 'DISMISS_PERMISSION_ONBOARDING' });
  },
  async revokeGrantedPermission(origin: string) {
    return send<{ status?: PermissionStatus; error?: string }>({ type: 'REVOKE_GRANTED_PERMISSION', origin });
  },

  // ---- misc ----
  async getActiveTabUrl(): Promise<{ url?: string; error?: string } | undefined> {
    return send<{ url?: string; error?: string }>({ type: 'GET_ACTIVE_TAB_URL' });
  },
  async openLogs(): Promise<{ error?: string } | undefined> {
    return send<{ error?: string }>({ type: 'OPEN_LOGS' });
  },
  openOptionsPage(): void {
    const runtime = getChromeRuntime();
    if (runtime?.openOptionsPage) { runtime.openOptionsPage(); return; }
    window.open('/options.html', '_blank', 'noopener,noreferrer');
  },
  openDashboard(focusId?: number | string): void {
    const url = focusId != null ? `/index.html?focus=${encodeURIComponent(String(focusId))}` : '/index.html';
    const runtime = getChromeRuntime();
    const full = runtime?.getURL ? runtime.getURL(url.replace(/^\//, '')) : url;
    window.open(full, '_blank', 'noopener,noreferrer');
  },
  async getActiveTab(): Promise<{ url?: string; title?: string; favIconUrl?: string } | undefined> {
    const tabs = (window as any).browser?.tabs ?? (window as any).chrome?.tabs;
    if (!tabs?.query) return undefined;
    try {
      const result: any[] = await new Promise((resolve) => {
        const maybe = tabs.query({ active: true, currentWindow: true }, (r: any[]) => resolve(r || []));
        if (maybe && typeof maybe.then === 'function') maybe.then((r: any[]) => resolve(r || []));
      });
      const tab = result[0];
      if (!tab) return undefined;
      return { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl };
    } catch {
      return undefined;
    }
  },
};

export type Bridge = typeof bridge;
