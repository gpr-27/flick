import { useState } from 'react';
import { cn } from './cn';

const FALLBACK_AVATAR = '/avatar.png';

const SIZES = {
  xs: 'size-8',
  sm: 'size-11',
  md: 'size-[52px]',
  lg: 'size-24',
  xl: 'size-28',
} as const;
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

const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const second = words[1];
  const letters = second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2);
  return letters.toUpperCase();
};

/** A picture, or the person's initials when there is none or it fails to load (404, expired link). */
export const Avatar = ({
  src,
  name,
  size = 'md',
  online = false,
  className,
  imgClassName,
}: AvatarProps) => {
  // The address that failed, so a new src gets a fresh try without any effect.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = brokenSrc !== null && brokenSrc === (src || FALLBACK_AVATAR);
  const initials = initialsOf(name);
  const showImage = !broken || !initials;
  return (
    <div className={cn('relative shrink-0', className)}>
      {showImage ? (
        <img
          src={src || FALLBACK_AVATAR}
          alt={name}
          onError={() => {
            setBrokenSrc(src || FALLBACK_AVATAR);
          }}
          className={cn(
            SIZES[size],
            'rounded-full object-cover',
            imgClassName ?? 'ring-1 ring-base-content/10',
          )}
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className={cn(
            SIZES[size],
            'grid select-none place-items-center rounded-full bg-active font-semibold text-primary-text',
            size === 'xs' ? 'text-xs' : size === 'xl' || size === 'lg' ? 'text-3xl' : 'text-base',
            imgClassName ?? 'ring-1 ring-base-content/10',
          )}
        >
          {initials}
        </span>
      )}
      {online && (
        <span
          aria-label="Online"
          role="img"
          className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-base-100 bg-[var(--online)]"
        />
      )}
    </div>
  );
};
