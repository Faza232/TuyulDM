import { useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export type TabItem = { value: string; label: ReactNode; count?: number };

export type TabsProps = {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
};

export function Tabs({ items, value, onChange, className, ...rest }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = items.findIndex((i) => i.value === value);
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    const nv = items[next].value;
    onChange(nv);
    refs.current[nv]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-1 border-b border-[var(--color-border-subtle)]', className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => { refs.current[item.value] = el; }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3 h-9 text-[13px]',
              'transition-colors duration-[var(--motion-fast)]',
              active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span className="font-mono text-[11px] text-[var(--color-text-dim)]">{item.count}</span>
            )}
            {active && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[var(--color-accent)]" />
            )}
          </button>
        );
      })}
    </div>
  );
}
