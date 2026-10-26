import { useEffect, useState } from 'react';
import { notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useAiEnabled } from '../useAiEnabled';
import { getPersona, setPersona } from './writingApi';

type Persona = 'default' | 'concise' | 'friendly' | 'formal' | 'tutor';
type Level = 'beginner' | 'intermediate' | 'advanced';

const PERSONAS: readonly { value: Persona; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'concise', label: 'Concise' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'tutor', label: 'Language tutor' },
];

/** Settings: how Flick talks to you. Added to Flick's instructions on the server. */
export const PersonaSettings = () => {
  const enabled = useAiEnabled();
  const [persona, setValue] = useState<Persona>('default');
  const [language, setLanguage] = useState('');
  const [level, setLevel] = useState<Level>('beginner');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    getPersona()
      .then((p) => {
        if (!live) return;
        setValue(p.persona);
        setLanguage(p.language ?? '');
        setLevel(p.level ?? 'beginner');
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (enabled === false) return null;

  const save = (next: { persona: Persona; language: string; level: Level }): void => {
    setPersona({
      persona: next.persona,
      language: next.persona === 'tutor' ? next.language.trim() || null : null,
      level: next.persona === 'tutor' ? next.level : null,
    })
      .then(() => {
        notify.success('Saved.');
      })
      .catch((e: unknown) => {
        notify.error(getErrorMessage(e, "Couldn't save."));
      });
  };

  return (
    <div className="mt-3 space-y-2 border-t border-base-content/10 pt-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Flick's personality
        <select
          className="select select-bordered h-12 text-base font-normal"
          value={persona}
          disabled={!loaded}
          onChange={(e) => {
            const next = e.target.value as Persona;
            setValue(next);
            if (next !== 'tutor') save({ persona: next, language, level });
          }}
        >
          {PERSONAS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {persona === 'tutor' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ persona, language, level });
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-xs font-semibold">
            Language to learn
            <input
              className="input input-bordered h-12 text-base font-normal"
              value={language}
              maxLength={40}
              placeholder="e.g. Spanish"
              onChange={(e) => {
                setLanguage(e.target.value.replace(/[^\p{L} -]/gu, ''));
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Level
            <select
              className="select select-bordered h-12 text-base font-normal"
              value={level}
              onChange={(e) => {
                setLevel(e.target.value as Level);
              }}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <button type="submit" className="btn btn-primary h-12" disabled={!language.trim()}>
            Save
          </button>
        </form>
      )}
    </div>
  );
};
