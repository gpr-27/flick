// The wallpaper chooser: a live preview, the built-in wallpapers by category, the pictures
// uploaded from this device, and a "dim" slider that keeps message bubbles readable.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ImagePlus, X } from 'lucide-react';
import { cn, notify } from '@/components/ui';
import { useSetting } from '@/features/settings/useSettingsStore';
import { MAX_CUSTOM_WALLPAPERS, useCustomWallpapers } from './customWallpapers';
import { useWallpaper } from './useWallpaper';
import { CATEGORIES, WALLPAPERS, isCustomId, type Wallpaper } from './wallpapers';

const Tile = ({
  label,
  style,
  selected,
  onSelect,
  className,
  children,
}: {
  label: string;
  style?: CSSProperties | undefined;
  selected: boolean;
  onSelect: () => void;
  className?: string | undefined;
  children?: ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={selected}
    aria-label={label}
    title={label}
    style={style}
    onClick={onSelect}
    className={cn(
      'relative h-20 w-full overflow-hidden rounded-xl border border-base-content/10 outline-none ring-offset-2 ring-offset-base-100 transition-transform focus-visible:ring-2 focus-visible:ring-primary active:scale-95',
      selected && 'ring-2 ring-primary',
      className,
    )}
  >
    {children}
    {selected && (
      <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-content shadow">
        <Check className="size-3.5" aria-hidden="true" />
      </span>
    )}
  </button>
);

const Preview = ({ id, dim }: { id: string | null; dim: number }) => {
  const { style } = useWallpaper(id);
  return (
    <div
      data-testid="wallpaper-preview"
      className={cn('relative isolate h-32 overflow-hidden rounded-2xl', !style && 'app-bg')}
      style={style ?? undefined}
    >
      {dim > 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{ background: `rgba(0,0,0,${String(dim / 100)})` }}
        />
      )}
      <div className="flex h-full flex-col justify-center gap-2 px-4 text-sm">
        <span className="max-w-[70%] self-start rounded-2xl rounded-bl-md bg-base-100 px-3 py-1.5 text-base-content shadow-sm">
          Hey, how is it going?
        </span>
        <span className="max-w-[70%] self-end rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-primary-content shadow-sm">
          Looks great
        </span>
      </div>
    </div>
  );
};

export const WallpaperPicker = ({
  value,
  onApply,
  onCancel,
  applyLabel = 'Apply',
}: {
  value: string | null;
  onApply: (id: string | null) => void;
  onCancel: () => void;
  applyLabel?: string;
}) => {
  const [selected, setSelected] = useState<string | null>(value);
  const [dim, setDim] = useSetting('wallpaperDim');
  const items = useCustomWallpapers((s) => s.items);
  const loaded = useCustomWallpapers((s) => s.loaded);
  const load = useCustomWallpapers((s) => s.load);
  const add = useCustomWallpapers((s) => s.add);
  const remove = useCustomWallpapers((s) => s.remove);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sections = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    void load();
  }, [load]);

  const missing = isCustomId(value) && loaded && !items.some((i) => i.id === value);
  const full = items.length >= MAX_CUSTOM_WALLPAPERS;

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      setSelected(await add(file));
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not use that picture.');
    } finally {
      setBusy(false);
    }
  };

  const removeCustom = (id: string): void => {
    void remove(id).then(() => {
      setSelected((s) => (s === id ? null : s));
    });
  };

  const byCategory = (c: string): Wallpaper[] => WALLPAPERS.filter((w) => w.category === c);

  return (
    <div className="space-y-3">
      <Preview id={selected} dim={dim} />

      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="group"
        aria-label="Wallpaper categories"
      >
        {[{ id: 'mine', label: 'My pictures' }, ...CATEGORIES].map((c) => (
          <button
            key={c.id}
            type="button"
            className="btn btn-xs btn-ghost shrink-0 rounded-full border border-base-content/10"
            onClick={() => {
              sections.current[c.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="max-h-[40dvh] space-y-4 overflow-y-auto pr-1">
        <div role="group" aria-label="Wallpapers" className="space-y-4">
          <section
            ref={(el) => {
              sections.current.mine = el;
            }}
            aria-labelledby="wp-mine"
          >
            <h3
              id="wp-mine"
              className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60"
            >
              My pictures
            </h3>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              <Tile
                label="Default"
                selected={selected === null}
                onSelect={() => {
                  setSelected(null);
                }}
                className="app-bg grid place-items-center text-xs font-semibold"
              >
                Default
              </Tile>
              <button
                type="button"
                disabled={busy || full}
                onClick={() => fileRef.current?.click()}
                className="flex h-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-base-content/30 text-xs font-medium hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                <ImagePlus className="size-5" aria-hidden="true" />
                {busy ? 'Preparing…' : 'Upload from gallery'}
              </button>
              {items.map((item, i) => (
                <div key={item.id} className="relative">
                  <Tile
                    label={`My picture ${String(items.length - i)}`}
                    style={{
                      backgroundImage: `url("${item.url}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    selected={selected === item.id}
                    onSelect={() => {
                      setSelected(item.id);
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove my picture ${String(items.length - i)}`}
                    onClick={() => {
                      removeCustom(item.id);
                    }}
                    className="absolute left-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs opacity-60">
              Custom wallpapers are stored on this device only
              {full ? ` (up to ${String(MAX_CUSTOM_WALLPAPERS)}; remove one to add another)` : ''}.
            </p>
            {missing && (
              <p role="status" className="mt-1 text-xs text-warning">
                This chat uses a custom wallpaper that is stored on another device, so the default
                shows here.
              </p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Choose a picture for the wallpaper"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void upload(file);
              }}
            />
          </section>

          {CATEGORIES.map((c) => (
            <section
              key={c.id}
              ref={(el) => {
                sections.current[c.id] = el;
              }}
              aria-labelledby={`wp-${c.id}`}
            >
              <h3
                id={`wp-${c.id}`}
                className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60"
              >
                {c.label}
              </h3>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {byCategory(c.id).map((w) => (
                  <Tile
                    key={w.id}
                    label={w.label}
                    style={w.style}
                    selected={selected === w.id}
                    onSelect={() => {
                      setSelected(w.id);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <span className="shrink-0">Dim wallpaper</span>
        <input
          type="range"
          min={0}
          max={60}
          step={5}
          value={dim}
          aria-label="Dim wallpaper"
          aria-valuetext={`${String(dim)} percent`}
          onChange={(e) => {
            setDim(Number(e.target.value));
          }}
          className="range range-primary range-xs min-w-0 flex-1"
        />
        <span className="w-9 shrink-0 text-right text-xs tabular-nums opacity-70">{dim}%</span>
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            onApply(selected);
          }}
        >
          {applyLabel}
        </button>
      </div>
    </div>
  );
};
