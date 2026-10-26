import type { ReactNode } from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  /** One button that fixes the emptiness ("Start a chat"). */
  action?: { label: string; onClick: () => void };
}

export const EmptyState = ({ icon, title, description, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center gap-3 px-8 py-14 text-center">
    <div
      aria-hidden="true"
      className="grid size-16 place-items-center rounded-2xl bg-active text-primary-text [&>svg]:size-8"
    >
      {icon}
    </div>
    <p className="text-[17px] font-semibold">{title}</p>
    {description && (
      <p className="max-w-[18rem] text-sm leading-relaxed text-[var(--text-2)]">{description}</p>
    )}
    {action && (
      <Button variant="primary" size="md" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </div>
);
