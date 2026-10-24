import { cn } from '@/components/ui';

/** Small line under any AI answer saying which model wrote it. */
export const ModelTag = ({ label, className }: { label: string | null; className?: string }) =>
  label ? (
    <p className={cn('text-[11px] text-base-content/50', className)}>Answered by {label}</p>
  ) : null;
