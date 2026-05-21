import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../cn';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  side?: TooltipSide;
  delay?: number;
  className?: string;
  children: ReactElement;
}

const SIDE: Record<TooltipSide, string> = {
  top: 'bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2',
  bottom: 'top-[calc(100%+6px)] left-1/2 -translate-x-1/2',
  left: 'right-[calc(100%+6px)] top-1/2 -translate-y-1/2',
  right: 'left-[calc(100%+6px)] top-1/2 -translate-y-1/2',
};

export function Tooltip({ content, side = 'top', delay = 300, className, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<number | null>(null);

  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };

  if (!isValidElement(children)) return children as unknown as ReactElement;

  const triggerProps: {
    'aria-describedby'?: string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    style?: CSSProperties;
  } = {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    style: { ...(children.props as { style?: CSSProperties }).style, position: 'relative' },
  };

  return (
    <span className="relative inline-flex">
      {cloneElement(children, triggerProps as Partial<typeof children.props>)}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 whitespace-nowrap rounded-[var(--radius-sm)]',
            'bg-[var(--color-surface-raised)] border border-[var(--color-border)]',
            'px-1.5 py-1 text-[11px] text-[var(--color-text)] shadow-lg',
            SIDE[side],
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
