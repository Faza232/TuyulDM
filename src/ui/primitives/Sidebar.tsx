import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface SidebarProps extends HTMLAttributes<HTMLElement> {
  collapsed?: boolean;
  width?: number;
  collapsedWidth?: number;
  ariaLabel?: string;
  children: ReactNode;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { collapsed = false, width = 220, collapsedWidth = 56, ariaLabel = 'Sidebar', className, children, style, ...rest },
  ref,
) {
  return (
    <nav
      ref={ref}
      aria-label={ariaLabel}
      data-collapsed={collapsed || undefined}
      style={{ width: collapsed ? collapsedWidth : width, ...style }}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-[var(--color-border-subtle)]',
        'bg-[var(--color-surface)] transition-[width] duration-[var(--motion-default)] ease-[var(--motion-ease)]',
        className,
      )}
      {...rest}
    >
      {children}
    </nav>
  );
});

export interface SidebarSectionProps {
  label?: ReactNode;
  collapsed?: boolean;
  className?: string;
  children: ReactNode;
}

export function SidebarSection({ label, collapsed, className, children }: SidebarSectionProps) {
  return (
    <div className={cn('flex flex-col gap-0.5 px-2 py-2', className)}>
      {label && !collapsed ? (
        <div className="px-2 pt-1 pb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export interface SidebarItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  label: ReactNode;
  active?: boolean;
  count?: number;
  collapsed?: boolean;
}

export const SidebarItem = forwardRef<HTMLButtonElement, SidebarItemProps>(function SidebarItem(
  { icon, label, active, count, collapsed, className, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[13px]',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        active
          ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]',
        className,
      )}
      {...rest}
    >
      {active ? (
        <span aria-hidden className="absolute left-0 top-1.5 h-5 w-[2px] rounded-r bg-[var(--color-accent)]" />
      ) : null}
      {icon ? (
        <span className="inline-flex shrink-0 [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
      ) : null}
      {!collapsed ? <span className="flex-1 truncate text-left">{label}</span> : null}
      {!collapsed && typeof count === 'number' ? (
        <span className="font-mono text-[11px] text-[var(--color-text-dim)]">{count}</span>
      ) : null}
    </button>
  );
});
