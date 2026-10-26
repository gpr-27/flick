import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

const VARIANTS = {
  gradient: 'btn-grad font-semibold',
  primary: 'btn-grad font-semibold',
  secondary: 'bg-base-300 font-semibold text-base-content hover:bg-base-content/10',
  ghost: 'font-medium text-base-content hover:bg-[var(--bg-hover)]',
  danger: 'bg-error font-semibold text-error-content hover:brightness-95',
  dashed:
    'border border-dashed border-base-content/25 font-semibold text-[var(--text-2)] hover:bg-[var(--bg-hover)]',
};

const SIZES = {
  sm: 'h-8 rounded-[10px] px-3 text-sm',
  md: 'h-10 rounded-xl px-4 text-[15px]',
  lg: 'h-12 w-full rounded-xl text-base',
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
      'tap-target inline-flex items-center justify-center gap-2 transition-[transform,background-color,filter] duration-150 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
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
