import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { UiPreferences, AdapterSettings } from './types';

const PREFS_KEY = 'tuyuldm_ui_prefs';
const ADAPTER_KEY = 'tuyuldm_adapter_settings';

const DEFAULT_PREFS: UiPreferences = {
  density: 'cozy',
  accent: '#FAFAFA',
  openOnFinish: false,
  segments: 8,
};

const DEFAULT_ADAPTER: AdapterSettings = {
  resolverEnabled: false,
  binaryPath: '',
  resolveTimeoutMs: 30000,
  debugLogging: false,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

interface PreferencesValue {
  prefs: UiPreferences;
  setPrefs: (patch: Partial<UiPreferences>) => void;
  adapter: AdapterSettings;
  setAdapter: (patch: Partial<AdapterSettings>) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<UiPreferences>(() => {
    // migrate legacy segments key
    const base = load(PREFS_KEY, DEFAULT_PREFS);
    const legacySegments = localStorage.getItem('tuyuldm_segments');
    if (legacySegments && base.segments === DEFAULT_PREFS.segments) {
      const n = parseInt(legacySegments, 10);
      if (Number.isFinite(n)) base.segments = n;
    }
    return base;
  });
  const [adapter, setAdapterState] = useState<AdapterSettings>(() => load(ADAPTER_KEY, DEFAULT_ADAPTER));

  useEffect(() => { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }, [prefs]);
  useEffect(() => { localStorage.setItem(ADAPTER_KEY, JSON.stringify(adapter)); }, [adapter]);

  // expose accent as a CSS variable override
  useEffect(() => {
    document.documentElement.style.setProperty('--color-accent', prefs.accent);
  }, [prefs.accent]);

  const setPrefs = (patch: Partial<UiPreferences>) => setPrefsState((p) => ({ ...p, ...patch }));
  const setAdapter = (patch: Partial<AdapterSettings>) => setAdapterState((a) => ({ ...a, ...patch }));

  const value = useMemo(() => ({ prefs, setPrefs, adapter, setAdapter }), [prefs, adapter]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    return { prefs: DEFAULT_PREFS, setPrefs: () => {}, adapter: DEFAULT_ADAPTER, setAdapter: () => {} };
  }
  return ctx;
}
