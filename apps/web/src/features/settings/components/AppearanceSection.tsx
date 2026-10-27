import { cn } from '@/components/ui';
import { ACCENTS, FONT_FAMILIES } from '../appearance';
import type { AccentId, FontFamily } from '../settingsSchema';
import { useSetting } from '../useSettingsStore';
import { ChatWallpaperSection } from './ChatWallpaperSection';
import { Card, ChoiceRow, ToggleRow } from './controls';

const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

export const AppearanceSection = () => {
  const [theme, setTheme] = useSetting('theme');
  const [accent, setAccent] = useSetting('accent');
  const [fontSize, setFontSize] = useSetting('fontSize');
  const [fontFamily, setFontFamily] = useSetting('fontFamily');
  const [density, setDensity] = useSetting('density');
  const [corners, setCorners] = useSetting('corners');
  const [reduceMotion, setReduceMotion] = useSetting('reduceMotion');
  const [dyslexiaFont, setDyslexiaFont] = useSetting('dyslexiaFont');
  const [highContrast, setHighContrast] = useSetting('highContrast');

  return (
    <Card title="Appearance">
      <ChoiceRow
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ]}
      />

      <div className="py-1">
        <p className="font-semibold" id="accent-label">
          Accent colour
        </p>
        <div role="radiogroup" aria-labelledby="accent-label" className="mt-2 flex flex-wrap gap-2">
          {ACCENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={accent === id}
              aria-label={ACCENTS[id].label}
              onClick={() => {
                setAccent(id);
              }}
              className={cn(
                'grid size-11 place-items-center rounded-full border-2 transition-transform active:scale-95',
                accent === id ? 'border-base-content' : 'border-transparent',
              )}
            >
              <span
                className="size-7 rounded-full"
                style={{ backgroundColor: ACCENTS[id].swatch }}
              />
            </button>
          ))}
        </div>
      </div>

      <ChoiceRow
        label="Text size"
        hint="Small, Normal, Large or Extra large; the whole app scales."
        value={fontSize}
        onChange={setFontSize}
        options={[
          { value: 'small', label: 'Small' },
          { value: 'normal', label: 'Normal' },
          { value: 'large', label: 'Large' },
          { value: 'xlarge', label: 'Extra large' },
        ]}
      />
      <ChoiceRow
        label="Font"
        value={fontFamily}
        onChange={setFontFamily}
        options={(Object.keys(FONT_FAMILIES) as FontFamily[]).map((id) => ({
          value: id,
          label: FONT_FAMILIES[id].label,
        }))}
      />
      <p className="rounded-2xl bg-base-content/5 p-3 text-sm" data-testid="font-preview">
        Preview: the quick brown fox jumps over the lazy dog. 0123456789
      </p>
      <ChoiceRow
        label="Density"
        hint="Compact fits more chats and messages on screen."
        value={density}
        onChange={setDensity}
        options={[
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ]}
      />
      <ChoiceRow
        label="Message corners"
        value={corners}
        onChange={setCorners}
        options={[
          { value: 'rounded', label: 'Rounded' },
          { value: 'sharp', label: 'Sharp' },
        ]}
      />
      <ToggleRow
        label="Reduce motion"
        hint="Fewer animations. Also on whenever your device asks for less motion."
        checked={reduceMotion}
        onChange={setReduceMotion}
      />
      <ToggleRow
        label="Dyslexia-friendly text"
        hint="Wider letter and line spacing with plain system fonts."
        checked={dyslexiaFont}
        onChange={setDyslexiaFont}
      />
      <ToggleRow
        label="High contrast"
        hint="Darker text and stronger borders for easier reading."
        checked={highContrast}
        onChange={setHighContrast}
      />
      <ChatWallpaperSection />
    </Card>
  );
};
