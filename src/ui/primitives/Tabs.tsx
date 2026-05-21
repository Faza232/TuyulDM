import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../cn';

interface TabsContextValue {
  value: string;
  onChange: (v: string) => void;
  baseId: string;
  orientation: 'horizontal' | 'vertical';
  registerTab: (v: string, el: HTMLButtonElement | null) => void;
  tabOrder: React.MutableRefObject<string[]>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs.* must be used inside <Tabs>');
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, orientation = 'horizontal', className, children }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabOrder = useRef<string[]>([]);

  const registerTab = useCallback((v: string, el: HTMLButtonElement | null) => {
    if (el) {
      tabRefs.current.set(v, el);
      if (!tabOrder.current.includes(v)) tabOrder.current.push(v);
    } else {
      tabRefs.current.delete(v);
      tabOrder.current = tabOrder.current.filter(x => x !== v);
    }
  }, []);

  const ctx = useMemo<TabsContextValue>(
    () => ({ value, onChange: onValueChange, baseId, orientation, registerTab, tabOrder }),
    [value, onValueChange, baseId, orientation, registerTab],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn(orientation === 'vertical' ? 'flex gap-4' : 'flex flex-col gap-3', className)}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}

export function TabList({ className, children, ariaLabel }: TabListProps) {
  const { orientation } = useTabs();
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={cn(
        orientation === 'vertical'
          ? 'flex flex-col gap-0.5 border-r border-[var(--color-border-subtle)] pr-2'
          : 'flex items-center gap-1 border-b border-[var(--color-border-subtle)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function Tab({ value, className, disabled, children }: TabProps) {
  const ctx = useTabs();
  const isActive = ctx.value === value;
  const ref = useRef<HTMLButtonElement | null>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const order = ctx.tabOrder.current;
    const idx = order.indexOf(value);
    if (idx < 0) return;
    const last = order.length - 1;
    let nextIdx: number | null = null;
    const horizontal = ctx.orientation === 'horizontal';
    if ((horizontal && e.key === 'ArrowRight') || (!horizontal && e.key === 'ArrowDown')) {
      nextIdx = idx === last ? 0 : idx + 1;
    } else if ((horizontal && e.key === 'ArrowLeft') || (!horizontal && e.key === 'ArrowUp')) {
      nextIdx = idx === 0 ? last : idx - 1;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = last;
    }
    if (nextIdx === null) return;
    e.preventDefault();
    const nextValue = order[nextIdx];
    ctx.onChange(nextValue);
  };

  return (
    <button
      ref={el => {
        ref.current = el;
        ctx.registerTab(value, el);
      }}
      role="tab"
      type="button"
      id={`${ctx.baseId}-tab-${value}`}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={() => ctx.onChange(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative inline-flex items-center gap-2 text-[13px] font-medium tracking-tight',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        ctx.orientation === 'horizontal'
          ? cn(
              'h-9 px-2 -mb-px border-b-2',
              isActive
                ? 'text-[var(--color-text)] border-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text)]',
            )
          : cn(
              'h-8 justify-start rounded-[var(--radius-sm)] px-2.5',
              isActive
                ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]',
            ),
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  className?: string;
  children: ReactNode;
}

export function TabPanel({ value, className, children }: TabPanelProps) {
  const ctx = useTabs();
  const isActive = ctx.value === value;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      hidden={!isActive}
      className={cn(isActive ? 'block' : 'hidden', className)}
    >
      {children}
    </div>
  );
}
