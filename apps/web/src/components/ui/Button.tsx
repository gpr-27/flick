import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

const VARIANTS = {
  gradient: 'btn-grad font-semibold text-white',
  dashed:
    'border border-dashed border-base-content/25 font-semibold text-base-content/70 hover:bg-base-content/5',
};

const SIZES = {
  md: 'h-11 rounded-2xl px-5',
  lg: 'h-12 w-full rounded-2xl text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = ({
  variant,
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) => (
  <button
    type="button"
    disabled={disabled ?? loading}
    aria-busy={loading || undefined}
    className={cn(
      'inline-flex items-center justify-center gap-2 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
      VARIANTS[variant],
      SIZES[size],
      className,
    )}
    {...rest}
  >
    {loading ? <Spinner size="sm" label={null} /> : icon}
    {children}
  </button>
);
