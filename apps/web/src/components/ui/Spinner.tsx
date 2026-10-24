import { Loader2 } from 'lucide-react';
import { cn } from './cn';

const SIZES = { xs: 'size-3.5', sm: 'size-4', lg: 'size-10' } as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  /** Accessible label; null when a parent already announces the busy state. */
  label?: string | null;
  className?: string;
}

export const Spinner = ({ size = 'sm', label = 'Loading', className }: SpinnerProps) => (
  <Loader2
    className={cn('animate-spin text-primary', SIZES[size], className)}
    role={label ? 'status' : undefined}
    aria-label={label ?? undefined}
    aria-hidden={label ? undefined : true}
  />
);
