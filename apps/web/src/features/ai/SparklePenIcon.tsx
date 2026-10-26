import type { SVGProps } from 'react';

/** A pen with a sparkle: the "Help me write" mark. Sized and coloured like a lucide icon. */
export const SparklePenIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M12 20h9" />
    <path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    <path d="M5 3v4M3 5h4" />
  </svg>
);
