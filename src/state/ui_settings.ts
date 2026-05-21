import { useState, useEffect } from 'react';

export type Density = 'cozy' | 'compact';

export interface UISettings {
  density: Density;
  accent: string;
}

const DEFAULT_SETTINGS: UISettings = {
  density: 'cozy',
  accent: '#FAFAFA'
};

export function useUISettings() {
  const [settings, setSettings] = useState<UISettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const saved = localStorage.getItem('tuyul_ui_settings');
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch (e) {}
    }
  }, []);

  const updateSettings = (updates: Partial<UISettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('tuyul_ui_settings', JSON.stringify(next));
      window.dispatchEvent(new Event('tuyul_ui_settings_changed'));
      return next;
    });
  };

  useEffect(() => {
    const handleSync = () => {
      const saved = localStorage.getItem('tuyul_ui_settings');
      if (saved) {
        try {
          const s = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
          setSettings(s);
        } catch (e) {}
      }
    };
    window.addEventListener('tuyul_ui_settings_changed', handleSync);
    window.addEventListener('storage', (e) => {
        if (e.key === 'tuyul_ui_settings') handleSync();
    });
    // Apply body classes
    document.documentElement.setAttribute('data-density', settings.density);
    
    return () => {
      window.removeEventListener('tuyul_ui_settings_changed', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, [settings.density]);

  return { uiSettings: settings, updateUISettings: updateSettings };
}
