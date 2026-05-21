import { useState, useEffect, useCallback } from 'react';
import { bridge } from './bridge';
import type { DetectedStreamItem } from './types';

export function useDetection() {
  const [streams, setStreams] = useState<DetectedStreamItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [tabUrl, setTabUrl] = useState<string | undefined>();

  const fetchActiveTabUrl = useCallback(async () => {
    try {
      const response = await bridge.getActiveTabUrl();
      if (response.url) {
        setTabUrl(response.url);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchStreams = useCallback(async () => {
    try {
      const data = await bridge.getDetectedStreams();
      setStreams(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const scan = async () => {
    setIsScanning(true);
    try {
      const data = await bridge.scanPage();
      setStreams(data);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    fetchActiveTabUrl();
    fetchStreams();
    const interval = setInterval(fetchStreams, 2000);
    return () => clearInterval(interval);
  }, [fetchActiveTabUrl, fetchStreams]);

  return { streams, isScanning, scan, tabUrl, refresh: fetchStreams };
}
