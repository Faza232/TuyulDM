import { useEffect } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Density = 'cozy' | 'compact';
export type AppRoute = 'queue' | 'finished' | 'grabber' | 'logs' | 'settings';

export interface UISettings {
  density: Density;
  accent: string;
  route: AppRoute;
  sidebarCollapsed: boolean;
  shortcutsOpen: boolean;
}

const DEFAULT_SETTINGS: UISettings = {
  density: 'cozy',
  accent: '#FAFAFA',
  route: 'queue',
  sidebarCollapsed: false,
  shortcutsOpen: false,
};

interface Store {
  uiSettings: UISettings;
  updateUISettings: (patch: Partial<UISettings>) => void;
}

export const useUISettingsStore = create<Store>()(
  persist(
    (set) => ({
      uiSettings: DEFAULT_SETTINGS,
      updateUISettings: (patch) =>
        set((s) => ({ uiSettings: { ...s.uiSettings, ...patch } })),
    }),
    {
      name: 'tuyul_ui_settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        uiSettings: {
          density: s.uiSettings.density,
          accent: s.uiSettings.accent,
          route: s.uiSettings.route,
          sidebarCollapsed: s.uiSettings.sidebarCollapsed,
        },
      }),
      merge: (persisted, current) => {
        const p = (persisted as Partial<Store> | undefined)?.uiSettings ?? {};
        return {
          ...current,
          uiSettings: { ...DEFAULT_SETTINGS, ...p, shortcutsOpen: false },
        };
      },
    },
  ),
);

export function useUISettings() {
  const uiSettings = useUISettingsStore((s) => s.uiSettings);
  const updateUISettings = useUISettingsStore((s) => s.updateUISettings);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', uiSettings.density);
  }, [uiSettings.density]);

  return { uiSettings, updateUISettings };
}
