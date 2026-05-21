import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search } from '../icons';
import { Kbd } from './Kbd';
import { useBodyScrollLock } from './_focus';
import { cn } from '../cn';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  group?: string;
  icon?: ReactNode;
  shortcut?: string[];
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder?: string;
  emptyMessage?: ReactNode;
}

function score(item: CommandItem, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const haystack = [item.label, item.description ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase();
  if (haystack.includes(q)) return 2;
  let i = 0;
  for (const ch of q) {
    const next = haystack.indexOf(ch, i);
    if (next < 0) return 0;
    i = next + 1;
  }
  return 1;
}

export function CommandPalette({
  open,
  onClose,
  items,
  placeholder = 'Type a command…',
  emptyMessage = 'No matches',
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIdx(0);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const scored = items
      .map(item => ({ item, score: score(item, query) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map(s => s.item);
  }, [items, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const key = item.group ?? 'General';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) {
        item.onSelect();
        onClose();
      }
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div aria-hidden className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              'relative w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] border',
              'border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl',
            )}
          >
            <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
              <Search className="size-4 text-[var(--color-text-dim)]" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder={placeholder}
                className="h-11 w-full bg-transparent text-[14px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
                aria-controls="command-list"
                aria-activedescendant={filtered[activeIdx]?.id}
              />
              <Kbd>esc</Kbd>
            </div>
            <ul id="command-list" role="listbox" className="max-h-[360px] overflow-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-[13px] text-[var(--color-text-muted)]">{emptyMessage}</li>
              ) : null}
              {grouped.map(([group, list]) => (
                <li key={group} role="none">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">
                    {group}
                  </div>
                  <ul role="none" className="flex flex-col">
                    {list.map(item => {
                      const idx = filtered.indexOf(item);
                      const focused = idx === activeIdx;
                      return (
                        <li
                          key={item.id}
                          id={item.id}
                          role="option"
                          aria-selected={focused}
                          onMouseEnter={() => setActiveIdx(idx)}
                          onClick={() => {
                            item.onSelect();
                            onClose();
                          }}
                          className={cn(
                            'flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5',
                            focused ? 'bg-white/5' : '',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {item.icon ? (
                              <span className="inline-flex shrink-0 text-[var(--color-text-muted)] [&_svg]:size-3.5" aria-hidden>
                                {item.icon}
                              </span>
                            ) : null}
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-[13px] text-[var(--color-text)]">{item.label}</span>
                              {item.description ? (
                                <span className="truncate text-[11px] text-[var(--color-text-muted)]">{item.description}</span>
                              ) : null}
                            </span>
                          </span>
                          {item.shortcut?.length ? (
                            <span className="flex shrink-0 items-center gap-1">
                              {item.shortcut.map((k, i) => (
                                <Kbd key={`${item.id}-${i}-${k}`}>{k}</Kbd>
                              ))}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
