import { isApiError } from '@/lib/api';

export const gifErrorMessage = (error: unknown): string => {
  if (isApiError(error) && error.status === 503) return 'GIFs are not set up on this server.';
  if (isApiError(error) && error.status === 429)
    return 'Too many searches. Wait a minute and try again.';
  return "Couldn't load GIFs. Try again.";
};
