import { SignIn, SignUp } from '@clerk/clerk-react';
import { Navigate, useLocation } from 'react-router-dom';
import { safeReturnTo, signInUrlFor } from '../returnTo';

/**
 * Clerk's prebuilt sign-in and sign-up forms, inside Flick. They use path routing at /sign-in and
 * /sign-up, and each links to the other through signInUrl / signUpUrl. Without those links Clerk
 * sends "Sign up" (and the social-login "no account yet" step) to its hosted Account Portal, which
 * asks for a second Clerk account. After success the person lands in the app, or back on the page
 * they opened (a call link) through `redirect_url`.
 */
export const SignInPage = () => {
  const { pathname, search } = useLocation();
  const returnTo = safeReturnTo(search);

  let form;
  if (pathname.startsWith('/sign-up')) {
    form = <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />;
  } else if (pathname.startsWith('/sign-in')) {
    form = <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />;
  } else {
    // Any other address (a call link, a profile link): sign in first, then come back to it.
    return <Navigate to={signInUrlFor(pathname + search)} replace />;
  }

  const isCallLink = returnTo.startsWith('/call/');
  return (
    <main className="app-bg glow-top flex min-h-dvh-screen flex-col items-center justify-center gap-3 px-4 py-8">
      <div
        aria-hidden="true"
        className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-2xl font-bold text-white shadow-[var(--shadow-2)]"
      >
        F
      </div>
      <h1 className="text-[28px] font-bold leading-9">Flick</h1>
      <p className="mb-2 text-[var(--text-2)]">
        {isCallLink ? 'Sign in to join the call.' : 'Fast, simple messaging'}
      </p>
      {form}
    </main>
  );
};
