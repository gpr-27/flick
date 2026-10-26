import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** "card": standalone glass card (full screens); "inline": inside a panel. */
  variant?: 'card' | 'inline';
  className?: string;
}

export const ErrorState = ({
  title = 'Something went wrong',
  message,
  onRetry,
  retrying = false,
  variant = 'inline',
  className,
}: ErrorStateProps) => (
  <div
    role="alert"
    className={cn(
      'flex flex-col items-center gap-3 text-center',
      variant === 'card'
        ? 'glass-card relative z-10 w-full max-w-sm rounded-2xl p-8'
        : 'px-6 py-10',
      className,
    )}
  >
    <AlertTriangle aria-hidden="true" className="size-8 text-error" />
    <h2 className="text-[17px] font-semibold">{title}</h2>
    <p className="text-sm text-[var(--text-2)]">{message}</p>
    {onRetry && (
      <Button
        variant="primary"
        size="md"
        className="mt-2 w-full"
        onClick={onRetry}
        loading={retrying}
      >
        Retry
      </Button>
    )}
  </div>
);
