import { useState, useEffect, useCallback, useRef } from 'react';
import { bridge } from './bridge';
import type { DownloadItem } from './types';
import { useToast } from '../ui/primitives';
import { errorMessage } from './messages';
import type { MediaOffer } from '../../extension/src/shared/media_classify';

const POLL_FALLBACK_MS = 4000;

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useToast();
  const prevDownloads = useRef<DownloadItem[]>([]);

  const fetchDownloads = useCallback(async () => {
    try {
      const resp = await bridge.getDownloads();
      const data = Array.isArray(resp) ? resp : [];

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
                  const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
                    ? chrome.runtime.getURL('options.html?tab=adapters')
                    : '/options.html?tab=adapters';
                  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                    chrome.tabs.create({ url });
                  } else {
                    window.open(url, '_blank');
                  }
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

    const runtime = (window as unknown as {
      chrome?: { runtime?: { onMessage?: { addListener: (cb: (msg: unknown) => void) => void; removeListener: (cb: (msg: unknown) => void) => void } } };
      browser?: { runtime?: { onMessage?: { addListener: (cb: (msg: unknown) => void) => void; removeListener: (cb: (msg: unknown) => void) => void } } };
    });
    const onMessage = runtime.browser?.runtime?.onMessage ?? runtime.chrome?.runtime?.onMessage;
    const onMsg = (msg: unknown) => {
      const t = (msg as { type?: string } | null)?.type;
      if (t === 'LIST_UPDATE' || t === 'PROGRESS_UPDATE') {
        fetchDownloads();
      }
    };
    onMessage?.addListener(onMsg);

    // Fallback poll when extension runtime unavailable (dev server) or push misses.
    const interval = setInterval(fetchDownloads, POLL_FALLBACK_MS);

    return () => {
      onMessage?.removeListener(onMsg);
      clearInterval(interval);
    };
  }, [fetchDownloads]);

  const withRollback = async (
    id: string | number,
    nextStatus: DownloadItem['status'],
    op: () => Promise<unknown>,
    label: string,
  ) => {
    const before = downloads.find(d => d.id === id);
    if (!before) return;
    setDownloads(d => d.map(item => item.id === id ? { ...item, status: nextStatus } : item));
    try {
      await op();
    } catch (e) {
      setDownloads(d => d.map(item => item.id === id ? before : item));
      push({ tone: 'danger', title: `${label} failed`, body: String((e as Error)?.message ?? e) });
    } finally {
      fetchDownloads();
    }
  };

  const pause = (id: string | number) => withRollback(id, 'paused', () => bridge.pauseDownload(id), 'Pause');
  const resume = (id: string | number) => withRollback(id, 'downloading', () => bridge.resumeDownload(id), 'Resume');

  const cancel = async (id: string | number) => {
    const before = downloads.find(d => d.id === id);
    setDownloads(d => d.filter(item => item.id !== id));
    try {
      await bridge.cancelDownload(id);
    } catch (e) {
      if (before) setDownloads(d => [...d, before]);
      push({ tone: 'danger', title: 'Cancel failed', body: String((e as Error)?.message ?? e) });
    } finally {
      fetchDownloads();
    }
  };

  const refreshUrl = async (id: string | number) => {
    const download = downloads.find(d => d.id === id);
    if (!download) return;
    await bridge.refreshUrl(id, download.url || "");
    fetchDownloads();
  };

  const addDownload = async (url: string, filename?: string, headers?: Record<string, string>, offer?: Partial<MediaOffer>) => {
    await bridge.addDownload(url, filename, headers, offer);
    fetchDownloads();
  };

  return { downloads, isLoading, pause, resume, cancel, refreshUrl, addDownload, refresh: fetchDownloads };
}
