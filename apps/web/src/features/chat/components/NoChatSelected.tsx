import { MessageSquare, ShieldCheck, Sparkles, Zap } from 'lucide-react';

const FEATURES = [
  { icon: Zap, label: 'Realtime delivery' },
  { icon: Sparkles, label: 'Typing & read receipts' },
  { icon: ShieldCheck, label: 'Secure & private' },
] as const;

export const NoChatSelected = () => (
  <section className="app-bg relative flex h-full flex-1 flex-col items-center justify-center overflow-hidden p-10 text-center">
    <div className="blobs" aria-hidden="true" />

    <div className="relative max-w-md space-y-6">
      <div
        className="relative mx-auto grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-primary to-secondary text-primary-content shadow-xl shadow-primary/30"
        aria-hidden="true"
      >
        <MessageSquare className="size-9" strokeWidth={2.25} />
        <span className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/20" />
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-3xl font-bold">Welcome to Flick</h2>
        <p className="text-base-content/60">
          Pick a conversation from the left to start messaging — or search for someone new.
        </p>
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        {FEATURES.map(({ icon: Icon, label }) => (
          <li key={label} className="chip">
            <Icon className="size-3.5 text-primary" aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  </section>
);

export default NoChatSelected;
