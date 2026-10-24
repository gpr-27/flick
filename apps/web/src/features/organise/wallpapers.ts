// Wallpapers are a small fixed set. The pref value is the id; an unknown id (from a newer
// client) shows the normal background.
import type { CSSProperties } from 'react';

export interface Wallpaper {
  id: string;
  label: string;
  style: CSSProperties;
}

const dots = (color: string, bg: string): CSSProperties => ({
  backgroundColor: bg,
  backgroundImage: `radial-gradient(${color} 1.5px, transparent 1.5px)`,
  backgroundSize: '22px 22px',
});

const grid = (color: string, bg: string): CSSProperties => ({
  backgroundColor: bg,
  backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
  backgroundSize: '28px 28px',
});

export const WALLPAPERS: readonly Wallpaper[] = [
  { id: 'sand', label: 'Sand', style: { backgroundColor: '#efe6d8' } },
  { id: 'mint', label: 'Mint', style: { backgroundColor: '#d9efe3' } },
  { id: 'sky', label: 'Sky', style: { backgroundColor: '#d8e8f8' } },
  { id: 'rose', label: 'Rose', style: { backgroundColor: '#f6dce2' } },
  { id: 'night', label: 'Night', style: { backgroundColor: '#1d2433' } },
  { id: 'dots', label: 'Dots', style: dots('rgba(80,90,120,0.25)', '#eef0f6') },
  { id: 'grid', label: 'Grid', style: grid('rgba(80,90,120,0.14)', '#f4f1ea') },
  {
    id: 'waves',
    label: 'Waves',
    style: { backgroundImage: 'linear-gradient(135deg, #cfe3ff 0%, #e8d9ff 50%, #ffe1ec 100%)' },
  },
];

export const wallpaperStyle = (id: string | null): CSSProperties | null =>
  WALLPAPERS.find((w) => w.id === id)?.style ?? null;
