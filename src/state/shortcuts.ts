import { useEffect, useRef } from 'react';

export interface ShortcutDefinition {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
  description: string;
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

export function useShortcuts(shortcuts: ShortcutDefinition[]) {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);

      for (const shortcut of ref.current) {
        if (
          e.key.toLowerCase() !== shortcut.key.toLowerCase() ||
          !!shortcut.ctrl !== e.ctrlKey ||
          !!shortcut.meta !== e.metaKey ||
          !!shortcut.shift !== e.shiftKey ||
          !!shortcut.alt !== e.altKey
        ) {
          continue;
        }
        // Plain letter/space/delete shortcuts must not fire while typing.
        const hasModifier = !!(shortcut.ctrl || shortcut.meta || shortcut.alt);
        if (editable && !hasModifier && shortcut.key !== 'Escape') return;

        e.preventDefault();
        shortcut.handler(e);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
