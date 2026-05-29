import type { ReactNode } from 'react';
import { cn } from '../cn';

export type SidebarProps = {
  collapsed?: boolean;
  expandedWidth?: number;
  collapsedWidth?: number;
  children: ReactNode;
  className?: string;
};

export function Sidebar({
  collapsed = false,
  expandedWidth = 220,
  collapsedWidth = 56,
  children,
  className,
}: SidebarProps) {
  return (
    <nav
      style={{ width: collapsed ? collapsedWidth : expandedWidth }}
      className={cn(
        'flex flex-col shrink-0 h-full border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
        'transition-[width] duration-[var(--motion-default)] ease-[var(--motion-ease)]',
        className,
      )}
    >
      {children}
    </nav>
  );
}

export type SidebarItemProps = {
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
};

export function SidebarItem({ icon, label, count, active, collapsed, onClick }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 mx-2 px-2.5 h-8 rounded-[var(--radius-sm)] text-[13px]',
        'transition-colors duration-[var(--motion-fast)]',
        active
          ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]',
        collapsed && 'justify-center px-0 mx-2',
      )}
    >
      {active && <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--color-accent)]" />}
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate flex-1 text-left">{label}</span>}
      {!collapsed && typeof count === 'number' && (
        <span className="font-mono text-[11px] text-[var(--color-text-dim)]">{count}</span>
      )}
    </button>
  );
}
