import { useEffect, useRef } from 'react';

export type ShortcutHandler = (e: KeyboardEvent) => void;
// Keys: single like '[', 'space', 'enter', 'delete', '?', 'mod+k'
// Sequences: 'g q', 'g f' (space-separated, typed in order within 800ms).
export type ShortcutMap = Record<string, ShortcutHandler>;

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function keyName(e: KeyboardEvent): string {
  const k = e.key;
  if (k === ' ') return 'space';
  if (k === 'Escape') return 'escape';
  if (k === 'Enter') return 'enter';
  if (k === 'Delete' || k === 'Backspace') return 'delete';
  if (k === 'ArrowUp') return 'up';
  if (k === 'ArrowDown') return 'down';
  return k.toLowerCase();
}

export function useShortcuts(map: ShortcutMap, enabled = true) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const seq = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      const handlers = mapRef.current;
      const mod = e.metaKey || e.ctrlKey;
      const name = keyName(e);

      // mod combos always fire (even in inputs, for ⌘K)
      if (mod) {
        const combo = `mod+${name}`;
        if (handlers[combo]) { e.preventDefault(); handlers[combo](e); return; }
      }

      if (isEditable(e.target)) return;

      // sequence resolution (e.g. 'g q')
      const now = Date.now();
      if (seq.current && now - seq.current.at < 800) {
        const combo = `${seq.current.key} ${name}`;
        seq.current = null;
        if (handlers[combo]) { e.preventDefault(); handlers[combo](e); return; }
      }

      // does any registered sequence start with this key?
      const startsSeq = Object.keys(handlers).some((k) => k.includes(' ') && k.split(' ')[0] === name);
      if (startsSeq) { seq.current = { key: name, at: now }; return; }

      if (handlers[name]) { e.preventDefault(); handlers[name](e); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
