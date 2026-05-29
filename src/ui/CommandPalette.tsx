import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Search } from './icons';
import { useEscape, useBodyScrollLock } from './primitives';
import type { Command } from '../state/commands';
import { fuzzyScore } from '../state/commands';
import { motionSec } from './tokens';
import { cn } from './cn';

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  commands: Command[];
};

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEscape(open, onClose);
  useBodyScrollLock(open);

  useEffect(() => {
    if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((c) => ({ c, score: Math.max(fuzzyScore(query, c.title), fuzzyScore(query, c.subtitle || '')) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }, [query, commands]);

  useEffect(() => { setActive(0); }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = results[active];
      if (cmd) { onClose(); cmd.run(); }
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] p-4" role="presentation">
          <motion.div
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: motionSec.fast }}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label="Command palette"
            className="relative z-10 w-full max-w-lg rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.98, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: motionSec.default }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 px-3 h-12 border-b border-[var(--color-border-subtle)]">
              <Search size={16} className="text-[var(--color-text-dim)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command…"
                className="flex-1 bg-transparent outline-none text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-dim)]"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto py-1">
              {results.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] text-[var(--color-text-dim)]">No commands match.</p>
              )}
              {results.map((cmd, i) => (
                <button
                  key={cmd.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { onClose(); cmd.run(); }}
                  className={cn(
                    'flex items-center justify-between gap-3 w-full px-3 h-9 text-left',
                    active === i && 'bg-white/5',
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {cmd.icon && <span className="text-[var(--color-text-muted)] shrink-0">{cmd.icon}</span>}
                    <span className="text-[13px] text-[var(--color-text)] truncate">{cmd.title}</span>
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-dim)] shrink-0">{cmd.group}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
