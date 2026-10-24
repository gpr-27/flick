import type { ReactNode } from 'react';
import { cn } from './cn';

export interface BadgeProps {
  children: ReactNode;
  /** "chip": frosted pill; "count": solid primary unread counter. */
  variant?: 'chip' | 'count';
  className?: string;
  label?: string;
}

export const Badge = ({ children, variant = 'chip', className, label }: BadgeProps) => (
  <span
    aria-label={label}
    className={cn(
      variant === 'count'
        ? 'grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-content'
        : 'chip',
      className,
    )}
  >
    {children}
  </span>
);
