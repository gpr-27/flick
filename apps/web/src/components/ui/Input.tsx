import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Accessible label (visually hidden; the placeholder shows the hint). */
  label: string;
  leadingIcon?: ReactNode;
}

export const Input = ({ label, leadingIcon, className, ...rest }: InputProps) => {
  const id = useId();
  return (
    <div className="relative w-full">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {leadingIcon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
        >
          {leadingIcon}
        </span>
      )}
      <input
        id={id}
        className={cn('input-soft', Boolean(leadingIcon) && 'pl-9', className)}
        {...rest}
      />
    </div>
  );
};
