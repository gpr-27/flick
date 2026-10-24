import type { SyntheticEvent } from 'react';
import { cn } from './cn';

const FALLBACK_AVATAR = '/avatar.png';

const SIZES = { xs: 'size-8', sm: 'size-11', md: 'size-12', lg: 'size-24', xl: 'size-28' } as const;
export type AvatarSize = keyof typeof SIZES;

export interface AvatarProps {
  src?: string | null;
  /** Person's name; used as alt text. Pass "" when the name is shown next to it. */
  name: string;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
  imgClassName?: string;
}

const onImgError = (e: SyntheticEvent<HTMLImageElement>): void => {
  const img = e.currentTarget;
  img.onerror = null;
  if (!img.src.endsWith(FALLBACK_AVATAR)) img.src = FALLBACK_AVATAR;
};

export const Avatar = ({
  src,
  name,
  size = 'md',
  online = false,
  className,
  imgClassName,
}: AvatarProps) => (
  <div className={cn('relative shrink-0', className)}>
    <img
      src={src || FALLBACK_AVATAR}
      alt={name}
      onError={onImgError}
      className={cn(
        SIZES[size],
        'rounded-full object-cover',
        imgClassName ?? 'ring-1 ring-base-content/10',
      )}
    />
    {online && (
      <span
        aria-label="Online"
        role="img"
        className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-base-100 bg-success"
      />
    )}
  </div>
);
