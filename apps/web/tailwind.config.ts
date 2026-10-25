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
        sans: ['var(--app-font, "Nunito")', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--display-font, "Quicksand")', '"Nunito"', 'sans-serif'],
      },
      colors: {
        // Signature pastel accents (also available as daisyUI tokens below).
        lavender: '#B7A8FF',
        peach: '#FFB39C',
        mint: '#6FE3C2',
        ink: '#2E2A45',
      },
      boxShadow: {
        soft: '0 18px 50px -20px rgba(124, 108, 240, 0.30)',
        glow: '0 10px 30px -8px rgba(183, 168, 255, 0.55)',
        glasscard: '0 30px 80px -30px rgba(46, 42, 69, 0.28)',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'bubble-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
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
          from: { opacity: '0', transform: 'scale(0.94)' },
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
        'blob-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(4%, -6%, 0) scale(1.12)' },
          '66%': { transform: 'translate3d(-5%, 4%, 0) scale(0.95)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both',
        'bubble-in': 'bubble-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'heart-pop': 'heart-pop 0.8s ease-out both',
        'scale-in': 'scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
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
          primary: '#7C6CF0', // lavender-violet
          'primary-content': '#ffffff',
          secondary: '#FF9E80', // peach
          'secondary-content': '#3a2620',
          accent: '#6FE3C2', // mint
          'accent-content': '#06372b',
          neutral: '#2E2A45', // ink
          'neutral-content': '#F4F3FA',
          'base-100': '#ffffff', // solid card
          'base-200': '#F4F3FA', // app background
          'base-300': '#E9E7F5', // subtle dividers/fills
          'base-content': '#2E2A45', // ink text
          info: '#7C6CF0',
          success: '#43D6A3',
          warning: '#F5B544',
          error: '#F2607A',
          '--rounded-box': '1.5rem',
          '--rounded-btn': '1rem',
          '--rounded-badge': '1rem',
          '--animation-btn': '0.2s',
          '--border-btn': '1px',
        },
      },
      {
        'pastel-night': {
          primary: '#8B7BFF', // brightened violet for dark contrast
          'primary-content': '#15121f',
          secondary: '#FF9E80', // peach
          'secondary-content': '#2a1810',
          accent: '#6FE3C2', // mint
          'accent-content': '#06372b',
          neutral: '#ECE9F7', // light ink
          'neutral-content': '#1B1830',
          'base-100': '#1F1B2E', // elevated card surface
          'base-200': '#14111F', // app background
          'base-300': '#2A2540', // subtle dividers/fills
          'base-content': '#ECE9F7', // light text
          info: '#8B7BFF',
          success: '#43D6A3',
          warning: '#F5B544',
          error: '#F2607A',
          '--rounded-box': '1.5rem',
          '--rounded-btn': '1rem',
          '--rounded-badge': '1rem',
          '--animation-btn': '0.2s',
          '--border-btn': '1px',
        },
      },
    ],
  },
};

export default config;
