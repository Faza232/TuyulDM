import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../cn';

export interface MenuItemDef {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuGroup {
  id: string;
  label?: string;
  items: MenuItemDef[];
}

interface MenuContextValue {
  open: boolean;
  anchor: { x: number; y: number } | null;
  show: (x: number, y: number) => void;
  hide: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('Menu primitives must be used inside <Menu>');
  return ctx;
}

export interface MenuProps {
  groups: MenuGroup[];
  trigger?: ReactElement;
  className?: string;
  children?: ReactNode;
}

export function Menu({ groups, trigger, className, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const show = useCallback((x: number, y: number) => {
    setAnchor({ x, y });
    setOpen(true);
    setFocusIdx(0);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    setAnchor(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, hide]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(i => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(i => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      const item = flat[focusIdx];
      if (item && !item.disabled) {
        e.preventDefault();
        item.onSelect();
        hide();
      }
    }
  };

  const ctx = useMemo<MenuContextValue>(() => ({ open, anchor, show, hide }), [open, anchor, show, hide]);

  let triggerEl: ReactNode = null;
  if (trigger) {
    triggerEl = (
      <span
        onClick={(e: MouseEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          show(r.left, r.bottom + 4);
        }}
      >
        {trigger}
      </span>
    );
  }

  let menuStyle: CSSProperties | undefined;
  if (open && anchor) {
    menuStyle = { position: 'fixed', top: anchor.y, left: anchor.x, zIndex: 60 };
  }

  return (
    <MenuContext.Provider value={ctx}>
      {triggerEl}
      {children}
      <AnimatePresence>
        {open && anchor ? (
          <motion.div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            tabIndex={-1}
            onKeyDown={onKey}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
            style={menuStyle}
            className={cn(
              'min-w-[180px] rounded-[var(--radius-md)] border border-[var(--color-border)]',
              'bg-[var(--color-surface-raised)] py-1 shadow-2xl outline-none',
              className,
            )}
          >
            {groups.map((g, gi) => (
              <div key={g.id}>
                {g.label ? (
                  <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">
                    {g.label}
                  </div>
                ) : null}
                {g.items.map(item => {
                  const idx = flat.indexOf(item);
                  const focused = idx === focusIdx;
                  return (
                    <button
                      key={item.id}
                      role="menuitem"
                      type="button"
                      id={`${baseId}-${item.id}`}
                      disabled={item.disabled}
                      onMouseEnter={() => setFocusIdx(idx)}
                      onClick={() => {
                        if (item.disabled) return;
                        item.onSelect();
                        hide();
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-2 py-1.5 text-[13px]',
                        'transition-colors duration-[var(--motion-fast)] text-left',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                        item.tone === 'danger'
                          ? 'text-[var(--color-danger)]'
                          : 'text-[var(--color-text)]',
                        focused && !item.disabled
                          ? item.tone === 'danger'
                            ? 'bg-[var(--color-danger)]/10'
                            : 'bg-white/5'
                          : '',
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        {item.icon ? (
                          <span className="inline-flex shrink-0 text-[var(--color-text-muted)] [&_svg]:size-3.5" aria-hidden>
                            {item.icon}
                          </span>
                        ) : null}
                        {item.label}
                      </span>
                      {item.shortcut ? (
                        <span className="font-mono text-[11px] text-[var(--color-text-dim)]">{item.shortcut}</span>
                      ) : null}
                    </button>
                  );
                })}
                {gi < groups.length - 1 ? (
                  <div role="separator" className="my-1 h-px bg-[var(--color-border-subtle)]" />
                ) : null}
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MenuContext.Provider>
  );
}
