// The few building blocks every settings section is made of. Each row is a label, so the whole
// row is clickable, and at least 44px tall (min-h-[44px]) so it is easy to hit on a phone.
import { useId, type ReactNode } from 'react';
import { cn } from '@/components/ui';

/** A titled card. */
export const Card = ({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) => {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('glass-card space-y-1 rounded-3xl p-5 sm:p-6', className)}
    >
      <h3 id={id} className="mb-2 font-display text-lg font-bold">
        {title}
      </h3>
      {children}
    </section>
  );
};

const Text = ({ label, hint }: { label: string; hint?: string | undefined }) => (
  <span className="min-w-0">
    <span className="block font-semibold">{label}</span>
    {hint && <span className="block text-sm text-base-content/60">{hint}</span>}
  </span>
);

export const ToggleRow = ({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) => (
  <label className="flex min-h-[44px] items-center justify-between gap-4 py-1">
    <Text label={label} hint={hint} />
    <input
      type="checkbox"
      role="switch"
      className="toggle toggle-primary shrink-0"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.checked);
      }}
    />
  </label>
);

export const SelectRow = <T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) => (
  <label className="flex min-h-[44px] items-center justify-between gap-4 py-1">
    <Text label={label} hint={hint} />
    <select
      className="select select-bordered select-sm min-h-[44px] max-w-[55%] shrink-0"
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

/** A few buttons where exactly one is chosen (a radio group that looks like a segmented control). */
export const ChoiceRow = <T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) => {
  const id = useId();
  return (
    <div className="py-1">
      <p id={id} className="font-semibold">
        {label}
      </p>
      {hint && <p className="text-sm text-base-content/60">{hint}</p>}
      <div role="radiogroup" aria-labelledby={id} className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => {
              onChange(o.value);
            }}
            className={cn(
              'min-h-[44px] min-w-[44px] rounded-2xl border px-4 text-sm font-semibold transition-colors',
              value === o.value
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-base-content/15 hover:bg-base-content/5',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export const SliderRow = ({
  label,
  value,
  onChange,
  action,
}: {
  label: string;
  /** 0 to 1. */
  value: number;
  onChange: (value: number) => void;
  /** A button next to the slider (for example "Test"). */
  action?: ReactNode;
}) => (
  <div className="flex min-h-[44px] items-center justify-between gap-4 py-1">
    <label className="flex min-w-0 flex-1 items-center gap-3">
      <span className="font-semibold">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        className="range range-primary range-sm min-h-[44px] flex-1"
        aria-label={label}
        value={Math.round(value * 100)}
        onChange={(e) => {
          onChange(Number(e.target.value) / 100);
        }}
      />
    </label>
    {action}
  </div>
);

export const ActionButton = ({
  children,
  onClick,
  tone = 'default',
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'btn btn-sm min-h-[44px] rounded-2xl',
      tone === 'danger' ? 'btn-outline btn-error' : 'btn-outline',
    )}
  >
    {children}
  </button>
);
