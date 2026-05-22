import type {
  DownloadItem, HostStats, HostStatus, HostSettings,
  InterceptionSettings, PermissionStatus, DetectedStreamItem,
  RefreshUrlResponse, ActiveTabUrlResponse
} from './types';
import type { MediaOffer } from '../../extension/src/shared/media_classify';

interface RuntimeLike {
  sendMessage: (msg: unknown) => Promise<unknown>;
}

export function getChromeRuntime(): RuntimeLike | null {
  const w = window as unknown as {
    browser?: { runtime?: RuntimeLike };
    chrome?: { runtime?: RuntimeLike };
  };
  const runtime = w.browser?.runtime ?? w.chrome?.runtime;
  return runtime?.sendMessage ? runtime : null;
}

export function isExtensionRuntimeAvailable() {
  return !!getChromeRuntime();
}

export async function sendExtensionMessage<T = unknown>(message: Record<string, unknown>): Promise<T | undefined> {
  const runtime = getChromeRuntime();
  if (!runtime) {
    return undefined;
  }
  return runtime.sendMessage(message) as Promise<T | undefined>;
}

// Single typed client
export const bridge = {
  // Downloads
  async getDownloads(): Promise<DownloadItem[]> {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ downloads?: DownloadItem[] }>({ type: 'GET_DOWNLOADS' });
      return response?.downloads || [];
    }
    return fetch('/api/downloads').then((r) => r.json());
  },
  
  async addDownload(url: string, filename?: string, headers?: Record<string, string>, offer?: Partial<MediaOffer>): Promise<boolean> {
    if (isExtensionRuntimeAvailable()) {
      const response = await sendExtensionMessage<{ success?: boolean }>({ 
        type: 'ADD_DOWNLOAD', 
        url, 
        filename,
        headers,
        offer
      });
      return !!response?.success;
    }
    const response = await fetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, filename, headers, offer }),
    });
    return response.ok;
  },

  async pauseDownload(id: string | number): Promise<void> {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'PAUSE_DOWNLOAD', id });
      return;
    }
    await fetch(`/api/downloads/${id}/pause`, { method: 'POST' });
  },

  async resumeDownload(id: string | number): Promise<void> {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'RESUME_DOWNLOAD', id });
      return;
    }
    await fetch(`/api/downloads/${id}/resume`, { method: 'POST' });
  },

  async cancelDownload(id: string | number): Promise<void> {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'CANCEL_DOWNLOAD', id });
      return;
    }
    await fetch(`/api/downloads/${id}`, { method: 'DELETE' });
  },
  
  async pauseAllDownloads(): Promise<void> {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'PAUSE_ALL_DOWNLOADS' });
      return;
    }
    await fetch('/api/downloads/pause-all', { method: 'POST' });
  },
  
  async resumeAllDownloads(): Promise<void> {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'RESUME_ALL_DOWNLOADS' });
      return;
    }
    await fetch('/api/downloads/resume-all', { method: 'POST' });
  },

  // Settings
  async getHostSettings(): Promise<HostSettings | undefined> {
    const response = await sendExtensionMessage<{ settings?: HostSettings }>({ type: 'GET_HOST_SETTINGS' });
    return response?.settings;
  },
  
  async saveHostSettings(settings: HostSettings): Promise<void> {
    await sendExtensionMessage({ type: 'SAVE_HOST_SETTINGS', settings });
  },
  
  async getInterceptionSettings(): Promise<InterceptionSettings | undefined> {
    const response = await sendExtensionMessage<{ settings?: InterceptionSettings }>({ type: 'GET_INTERCEPTION_SETTINGS' });
    return response?.settings;
  },
  
  async saveInterceptionSettings(settings: InterceptionSettings): Promise<void> {
    await sendExtensionMessage({ type: 'SAVE_INTERCEPTION_SETTINGS', settings });
  },

  // Host Status
  async getHostStatus(): Promise<HostStatus | undefined> {
    if (isExtensionRuntimeAvailable()) {
      const { status } = await sendExtensionMessage<{ status?: HostStatus }>({ type: 'GET_HOST_STATUS' }) || {};
      return status;
    }
    return fetch('/api/host-status').then((r) => r.json());
  },
  
  async getHostStats(): Promise<{ stats?: HostStats; status?: HostStatus }> {
    if (isExtensionRuntimeAvailable()) {
      return await sendExtensionMessage<{ stats?: HostStats; status?: HostStatus }>({ type: 'GET_HOST_STATS' }) || {};
    }
    const stats = await fetch('/api/stats').then((r) => r.json());
    return { stats };
  },

  // Media & Detection
  async getDetectedStreams(): Promise<DetectedStreamItem[]> {
    const { streams } = await sendExtensionMessage<{ streams?: DetectedStreamItem[]; error?: string }>({ type: 'GET_DETECTED_STREAMS' }) || {};
    return streams || [];
  },
  
  async scanPage(): Promise<DetectedStreamItem[]> {
    const { streams } = await sendExtensionMessage<{ streams?: DetectedStreamItem[]; error?: string }>({ type: 'SCAN_PAGE' }) || {};
    return streams || [];
  },
  
  async getActiveTabUrl(): Promise<ActiveTabUrlResponse> {
    return await sendExtensionMessage<ActiveTabUrlResponse>({ type: 'GET_ACTIVE_TAB_URL' }) || {};
  },

  async refreshUrl(id: string | number, currentUrl: string): Promise<RefreshUrlResponse> {
    if (isExtensionRuntimeAvailable()) {
      return await sendExtensionMessage<RefreshUrlResponse>({
        type: 'REFRESH_URL',
        id,
        currentUrl
      }) || {};
    }
    return fetch(`/api/downloads/${id}/refresh-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentUrl }),
    }).then(r => r.json());
  },

  // File system interactions
  async openDownloadFile(id: string | number): Promise<void> {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'OPEN_DOWNLOAD_FILE', id });
      return;
    }
    await fetch(`/api/downloads/${id}/open`, { method: 'POST' });
  },
  
  async revealDownloadInFolder(id: string | number): Promise<void> {
    if (isExtensionRuntimeAvailable()) {
      await sendExtensionMessage({ type: 'REVEAL_DOWNLOAD_IN_FOLDER', id });
      return;
    }
    await fetch(`/api/downloads/${id}/reveal`, { method: 'POST' });
  },
  
  async selectDownloadFolder(): Promise<string | undefined> {
    const resp = await sendExtensionMessage<{ path?: string; error?: string }>({ type: 'SELECT_DOWNLOAD_FOLDER' });
    return resp?.path;
  },

  async openLogs(): Promise<void> {
    await sendExtensionMessage({ type: 'OPEN_LOGS' });
  },

  // Permissions
  async getPermissionStatus(): Promise<PermissionStatus | undefined> {
    const resp = await sendExtensionMessage<{ status?: PermissionStatus; error?: string }>({ type: 'GET_PERMISSION_STATUS' });
    return resp?.status;
  },
  
  async requestAllUrlsPermission(): Promise<PermissionStatus | undefined> {
    const resp = await sendExtensionMessage<{ granted?: boolean; status?: PermissionStatus; error?: string }>({ type: 'REQUEST_ALL_URLS_PERMISSION' });
    return resp?.status;
  },
  
  async dismissPermissionOnboarding(): Promise<PermissionStatus | undefined> {
    const resp = await sendExtensionMessage<{ status?: PermissionStatus; error?: string }>({ type: 'DISMISS_PERMISSION_ONBOARDING' });
    return resp?.status;
  },
  
  async requestCurrentTabPermission(): Promise<PermissionStatus | undefined> {
    const resp = await sendExtensionMessage<{ granted?: boolean; status?: PermissionStatus; error?: string }>({ type: 'REQUEST_CURRENT_TAB_PERMISSION' });
    return resp?.status;
  }
};
