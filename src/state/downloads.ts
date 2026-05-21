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

  return { downloads, isLoading, pause, resume, cancel, refresh: fetchDownloads };
}
