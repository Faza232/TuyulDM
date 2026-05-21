import { useState, useEffect, useCallback } from 'react';
import { bridge } from './bridge';
import type { PermissionStatus } from './types';

export function usePermissions() {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await bridge.getPermissionStatus();
      if (result) setStatus(result);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const requestCurrentOrigin = async () => {
    try {
      const result = await bridge.requestCurrentTabPermission();
      if (result) setStatus(result);
      return result?.currentOriginGranted;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const requestAllUrls = async () => {
    try {
      const result = await bridge.requestAllUrlsPermission();
      if (result) setStatus(result);
      return result?.hasAllUrlsPermission;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const dismissOnboarding = async () => {
    try {
      const result = await bridge.dismissPermissionOnboarding();
      if (result) setStatus(result);
    } catch (e) {
      console.error(e);
    }
  };

  return { status, isLoading, requestCurrentOrigin, requestAllUrls, dismissOnboarding, refresh: fetchStatus };
}
