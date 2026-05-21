import { useState, useEffect, useCallback, useRef } from 'react';
import { bridge } from './bridge';
import type { DownloadItem } from './types';
import { useToast } from '../ui/primitives';
import { errorMessage } from './messages';

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useToast();
  const prevDownloads = useRef<DownloadItem[]>([]);

  const fetchDownloads = useCallback(async () => {
    try {
      const data = await bridge.getDownloads();
      
      // Compare and emit toasts for new errors
      data.forEach(d => {
        const prev = prevDownloads.current.find(p => p.id === d.id);
        const isNewError = prev && prev.status !== 'error' && prev.status !== 'awaiting_url_refresh' && (d.status === 'error' || d.status === 'awaiting_url_refresh');
        
        if (isNewError) {
          const msg = errorMessage(d.error_code || d.error);
          push({
            tone: 'danger',
            title: msg.title,
            body: msg.body,
            action: msg.recovery ? {
              label: msg.recovery.label,
              onClick: () => {
                if (msg.recovery?.type === 'RefreshFromCurrentTab') {
                  bridge.refreshUrl(d.id, d.url || '');
                } else if (msg.recovery?.type === 'OpenAdapterSettings') {
                  // TODO: navigate to adapter settings
                } else if (msg.recovery?.type === 'RetryDownload') {
                  bridge.resumeDownload(d.id);
                }
              }
            } : undefined
          });
        }
      });
      prevDownloads.current = data;
      setDownloads(data);
    } catch (e) {
      console.error('Failed to fetch downloads', e);
    } finally {
      setIsLoading(false);
    }
  }, [push]);

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

  const refreshUrl = async (id: string | number) => {
    const download = downloads.find(d => d.id === id);
    if (!download) return;
    await bridge.refreshUrl(id, download.url || "");
    fetchDownloads();
  };

  const addDownload = async (url: string, filename?: string, headers?: Record<string, string>, offer?: any) => {
    await bridge.addDownload(url, filename, headers, offer);
    fetchDownloads();
  };

  return { downloads, isLoading, pause, resume, cancel, refreshUrl, addDownload, refresh: fetchDownloads };
}
