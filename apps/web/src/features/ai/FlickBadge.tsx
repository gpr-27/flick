import { BadgeCheck, Sparkles } from 'lucide-react';
import { cn } from '@/components/ui';
import type { AvatarSize } from '@/components/ui/Avatar';

/** A small verified-style "AI" tag shown next to the bot's name. */
export const FlickBadge = () => (
  <span
    role="img"
    aria-label="Flick AI assistant"
    title="Flick AI assistant"
    className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-primary to-secondary px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-primary-content"
  >
    <BadgeCheck className="size-3" aria-hidden="true" />
    AI
  </span>
);

const SIZES: Record<AvatarSize, { box: string; icon: string }> = {
  xs: { box: 'size-8', icon: 'size-4' },
  sm: { box: 'size-11', icon: 'size-5' },
  md: { box: 'size-12', icon: 'size-6' },
  lg: { box: 'size-24', icon: 'size-11' },
  xl: { box: 'size-28', icon: 'size-12' },
};

/** The bot's avatar: a gradient disc with a sparkle, used wherever avatars appear. */
export const FlickAvatar = ({
  size = 'md',
  className,
}: {
  size?: AvatarSize;
  className?: string;
}) => (
  <div
    role="img"
    aria-label="Flick"
    className={cn(
      'relative grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary via-secondary to-accent text-primary-content shadow-md shadow-primary/30 ring-2 ring-primary/20',
      SIZES[size].box,
      className,
    )}
  >
    <Sparkles className={SIZES[size].icon} aria-hidden="true" />
  </div>
);
