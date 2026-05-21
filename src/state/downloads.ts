import { useState, useEffect, useCallback } from 'react';
import { bridge } from './bridge';
import type { DownloadItem } from './types';

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDownloads = useCallback(async () => {
    try {
      const data = await bridge.getDownloads();
      setDownloads(data);
    } catch (e) {
      console.error('Failed to fetch downloads', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDownloads();
    const interval = setInterval(fetchDownloads, 1000);
    return () => clearInterval(interval);
  }, [fetchDownloads]);

  const pause = async (id: string | number) => {
    setDownloads(d => d.map(item => item.id === id ? { ...item, status: 'paused' } : item));
    await bridge.pauseDownload(id);
    fetchDownloads();
  };

  const resume = async (id: string | number) => {
    setDownloads(d => d.map(item => item.id === id ? { ...item, status: 'downloading' } : item));
    await bridge.resumeDownload(id);
    fetchDownloads();
  };

  const cancel = async (id: string | number) => {
    setDownloads(d => d.filter(item => item.id !== id));
    await bridge.cancelDownload(id);
    fetchDownloads();
  };

  const refreshUrl = async (id: string | number) => { const download = downloads.find(d => d.id === id); if (!download) return; await bridge.refreshUrl(id, download.url || ""); fetchDownloads(); }; const addDownload = async (url: string, filename?: string, headers?: Record<string, string>, offer?: any) => { await bridge.addDownload(url, filename, headers, offer); fetchDownloads(); }; return { downloads, isLoading, pause, resume, cancel, refreshUrl, addDownload, refresh: fetchDownloads };
}
