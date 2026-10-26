import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import daisyui from 'daisyui';
import type { Config } from 'tailwindcss';

const here = dirname(fileURLToPath(import.meta.url));

// Tailwind + daisyUI "Soft Pastel Glass" theme (light: pastel-glass, dark: pastel-night).
const config: Config & { daisyui: Record<string, unknown> } = {
  content: [join(here, 'index.html'), join(here, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--app-font, var(--font-ui))', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: [
          'var(--display-font, var(--font-ui))',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        // Signature pastel accents (also available as daisyUI tokens below).
        lavender: '#B7A8FF',
        peach: '#FFB39C',
        mint: '#6FE3C2',
        ink: '#1D1A2F',
        // Token-backed utilities: text-primary-text, bg-active, bg-sunken, bg-hover.
        'primary-text': 'var(--primary-text)',
        active: 'var(--bg-active)',
        sunken: 'var(--bg-sunken)',
        hover: 'var(--bg-hover)',
      },
      boxShadow: {
        soft: 'var(--shadow-2)',
        glow: 'var(--shadow-2)',
        glasscard: 'var(--shadow-3)',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'bubble-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // The heart that pops up on a double tap: grows, holds, then floats away.
        'heart-pop': {
          '0%': { opacity: '0', transform: 'scale(0.4)' },
          '30%': { opacity: '1', transform: 'scale(1.25)' },
          '60%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(1) translateY(-14px)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // An incoming call: rings spreading out from the avatar, and a phone that shakes.
        'ring-ripple': {
          '0%': { transform: 'scale(0.85)', opacity: '0.55' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'ring-shake': {
          '0%, 60%, 100%': { transform: 'rotate(0deg)' },
          '10%, 30%, 50%': { transform: 'rotate(-16deg)' },
          '20%, 40%': { transform: 'rotate(16deg)' },
        },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'blob-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(4%, -6%, 0) scale(1.12)' },
          '66%': { transform: 'translate3d(-5%, 4%, 0) scale(0.95)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.22s var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1)) both',
        'bubble-in': 'bubble-in 0.18s var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1)) both',
        'heart-pop': 'heart-pop 0.8s ease-out both',
        'scale-in': 'scale-in 0.18s var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1)) both',
        fade: 'fade 0.15s ease-out both',
        'sheet-up': 'sheet-up 0.28s var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1)) both',
        'blob-drift': 'blob-drift 22s ease-in-out infinite',
        'ring-ripple': 'ring-ripple 2.4s cubic-bezier(0.2, 0.6, 0.3, 1) infinite',
        'ring-shake': 'ring-shake 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    logs: false,
    darkTheme: 'pastel-night',
    themes: [
      {
        'pastel-glass': {
          primary: '#6252E0', // lavender-violet
          'primary-content': '#ffffff',
          secondary: '#FF9E80', // peach
          'secondary-content': '#3a2620',
          accent: '#6FE3C2', // mint
          'accent-content': '#06372b',
          neutral: '#1D1A2F', // ink
          'neutral-content': '#F5F4FA',
          'base-100': '#ffffff', // solid card
          'base-200': '#F5F4FA', // app background
          'base-300': '#ECEAF4', // sunken fills
          'base-content': '#1D1A2F', // ink text
          info: '#6252E0',
          success: '#43D6A3',
          warning: '#F5B544',
          error: '#E04561',
          '--rounded-box': '1.25rem',
          '--rounded-btn': '0.875rem',
          '--rounded-badge': '9999px',
          '--animation-btn': '0.15s',
          '--btn-focus-scale': '0.98',
          '--border-btn': '1px',
        },
      },
      {
        'pastel-night': {
          primary: '#8B7BFF', // brightened violet for dark contrast
          'primary-content': '#14101F',
          secondary: '#FF9E80', // peach
          'secondary-content': '#2a1810',
          accent: '#6FE3C2', // mint
          'accent-content': '#06372b',
          neutral: '#ECE9F7', // light ink
          'neutral-content': '#1A1726',
          'base-100': '#1A1726', // surface
          'base-200': '#121019', // app background
          'base-300': '#242036', // raised
          'base-content': '#ECE9F7', // light text
          info: '#8B7BFF',
          success: '#43D6A3',
          warning: '#F5B544',
          error: '#FF7A92',
          '--rounded-box': '1.25rem',
          '--rounded-btn': '0.875rem',
          '--rounded-badge': '9999px',
          '--animation-btn': '0.15s',
          '--btn-focus-scale': '0.98',
          '--border-btn': '1px',
        },
      },
    ],
  },
};

export default config;
