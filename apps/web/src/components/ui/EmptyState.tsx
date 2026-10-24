import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
}

export const EmptyState = ({ icon, title, description }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
    <div aria-hidden="true" className="text-base-content/40">
      {icon}
    </div>
    <p className="font-display text-base font-bold text-base-content/80">{title}</p>
    {description && (
      <p className="max-w-xs text-sm leading-relaxed text-base-content/60">{description}</p>
    )}
  </div>
);
