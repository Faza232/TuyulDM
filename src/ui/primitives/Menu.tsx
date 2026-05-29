import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from './overlay';
import { cn } from '../cn';

export type MenuItem =
  | { type?: 'item'; label: ReactNode; icon?: ReactNode; onSelect: () => void; disabled?: boolean; tone?: 'default' | 'danger' }
  | { type: 'separator' };

export type MenuProps = {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  // Fixed viewport coordinates (context menu). If omitted, caller wraps in a
  // relative container and the menu anchors below-left of it.
  position?: { x: number; y: number };
  className?: string;
};

export function Menu({ open, onClose, items, position, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEscape(open, onClose);

  const selectable = items
    .map((it, i) => ('type' in it && it.type === 'separator' ? -1 : i))
    .filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    setActive(selectable[0] ?? 0);
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function move(dir: 1 | -1) {
    const pos = selectable.indexOf(active);
    const next = selectable[(pos + dir + selectable.length) % selectable.length];
    setActive(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (it && (!('type' in it) || it.type === 'item') && !it.disabled) { it.onSelect(); onClose(); }
    }
  }

  const menu = (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={position ? { position: 'fixed', top: position.y, left: position.x } : undefined}
      className={cn(
        'z-50 min-w-[180px] py-1 rounded-[var(--radius-md)]',
        'bg-[var(--color-surface-raised)] border border-[var(--color-border)] shadow-2xl',
        !position && 'absolute right-0 mt-1',
        className,
      )}
    >
      {items.map((it, i) => {
        if ('type' in it && it.type === 'separator') {
          return <div key={i} className="my-1 h-px bg-[var(--color-border-subtle)]" />;
        }
        const item = it as Extract<MenuItem, { onSelect: () => void }>;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => { item.onSelect(); onClose(); }}
            className={cn(
              'flex items-center gap-2 w-full px-2.5 h-8 text-left text-[13px]',
              'disabled:opacity-40 disabled:pointer-events-none transition-colors duration-[var(--motion-fast)]',
              item.tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]',
              active === i && 'bg-white/5',
            )}
          >
            {item.icon && <span className="shrink-0 text-[var(--color-text-muted)]">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );

  return position ? createPortal(menu, document.body) : menu;
}
