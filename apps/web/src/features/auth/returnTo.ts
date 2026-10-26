/**
 * Where to go after signing in: the `redirect_url` Clerk carries on /sign-in and /sign-up, but only
 * a path on this site. Anything else (another origin, `//host`, a script) falls back to the app.
 */
export const safeReturnTo = (search: string): string => {
  const raw = new URLSearchParams(search).get('redirect_url');
  if (!raw) return '/';
  let path: string;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    path = url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  if (/^\/(sign-in|sign-up)(\/|$|\?)/.test(path)) return '/';
  return path;
};

/** The /sign-in address that brings the person back to `returnTo` afterwards. */
export const signInUrlFor = (returnTo: string): string =>
  returnTo === '/' ? '/sign-in' : `/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;
