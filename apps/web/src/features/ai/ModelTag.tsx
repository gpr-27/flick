import { cn } from '@/components/ui';
import { useSettingsStore } from '@/features/settings/useSettingsStore';

/** Small line under any AI answer saying which model wrote it. Settings > AI can turn it off. */
export const ModelTag = ({ label, className }: { label: string | null; className?: string }) => {
  const show = useSettingsStore((s) => s.showModelName);
  return label && show ? (
    <p className={cn('text-[11px] text-base-content/50', className)}>Answered by {label}</p>
  ) : null;
};
