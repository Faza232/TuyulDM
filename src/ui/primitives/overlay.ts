import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Focus trap + restore + Tab cycling for a modal container.
// Returns a ref to attach to the overlay root.
export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}

// Calls onEscape when Escape is pressed, only for the topmost overlay.
// Uses a global stack so nested overlays close one at a time.
const escStack: Array<() => void> = [];

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = () => onEscape();
    escStack.push(handler);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (escStack[escStack.length - 1] === handler) {
        e.stopPropagation();
        onEscape();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = escStack.indexOf(handler);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [active, onEscape]);
}

// Lock body scroll while any overlay is open.
let lockCount = 0;
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = prev;
    };
  }, [active]);
}
