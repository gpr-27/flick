import { ringOffset } from './ringOffset';

/** Circular upload progress, 0 to 1. */
export const ProgressRing = ({ fraction, size = 28 }: { fraction: number; size?: number }) => {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg
      role="progressbar"
      aria-label="Upload progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      width={size}
      height={size}
      className="mt-1 -rotate-90 text-primary"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={3}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={ringOffset(fraction, c)}
      />
    </svg>
  );
};
