import { useState, useEffect, useCallback } from 'react';
import { bridge } from './bridge';
import type { HostSettings, InterceptionSettings } from './types';

export function useSettings() {
  const [hostSettings, setHostSettings] = useState<HostSettings | null>(null);
  const [interceptionSettings, setInterceptionSettings] = useState<InterceptionSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const [host, interception] = await Promise.all([
        bridge.getHostSettings(),
        bridge.getInterceptionSettings()
      ]);
      if (host) setHostSettings(host);
      if (interception) setInterceptionSettings(interception);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateHostSettings = async (updates: Partial<HostSettings>) => {
    if (!hostSettings) return;
    const newSettings = { ...hostSettings, ...updates };
    setHostSettings(newSettings);
    await bridge.saveHostSettings(newSettings);
    await fetchSettings();
  };

  const updateInterceptionSettings = async (updates: Partial<InterceptionSettings>) => {
    if (!interceptionSettings) return;
    const newSettings = { ...interceptionSettings, ...updates };
    setInterceptionSettings(newSettings);
    await bridge.saveInterceptionSettings(newSettings);
    await fetchSettings();
  };

  return { hostSettings, interceptionSettings, isLoading, updateHostSettings, updateInterceptionSettings };
}
