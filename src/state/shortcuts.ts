import { useEffect } from 'react';

export interface ShortcutDefinition {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
  description: string;
}

export function useShortcuts(shortcuts: ShortcutDefinition[]) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if mostly in input/textarea unless it's an overlay trigger
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      
      for (const shortcut of shortcuts) {
        if (e.key.toLowerCase() === shortcut.key.toLowerCase() &&
            !!shortcut.ctrl === e.ctrlKey &&
            !!shortcut.meta === e.metaKey &&
            !!shortcut.shift === e.shiftKey &&
            !!shortcut.alt === e.altKey) {
          e.preventDefault();
          shortcut.handler(e);
          return;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}
