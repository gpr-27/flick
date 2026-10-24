import { useState } from 'react';
import { SignIn, SignUp } from '@clerk/clerk-react';

/** Clerk's prebuilt sign-in and sign-up forms. */
export const SignInPage = () => {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  // Stay on the page that was opened (for example a call link) once signed in.
  const returnTo = window.location.pathname + window.location.search;
  const isCallLink = window.location.pathname.startsWith('/call/');
  return (
    <main className="app-bg flex min-h-dvh-screen flex-col items-center justify-center gap-4 px-4 py-8">
      <div className="blobs" aria-hidden="true" />
      <h1 className="font-display text-3xl font-bold">Flick</h1>
      {isCallLink && <p className="text-base-content/70">Sign in to join the call.</p>}
      {mode === 'sign-in' ? (
        <SignIn routing="hash" fallbackRedirectUrl={returnTo} />
      ) : (
        <SignUp routing="hash" fallbackRedirectUrl={returnTo} />
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
        }}
      >
        {mode === 'sign-in' ? 'New to Flick? Create an account' : 'Have an account? Sign in'}
      </button>
    </main>
  );
};
