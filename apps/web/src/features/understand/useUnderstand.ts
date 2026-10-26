import { useCallback, useState } from 'react';
import { getErrorMessage } from '@/lib/api';
import { understand, type UnderstandResult } from './understandApi';

type Body = Parameters<typeof understand>[0];
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: UnderstandResult }
  | { status: 'error'; message: string };

/** Runs one /ai/understand request and keeps its state. */
export function useUnderstand() {
  const [state, setState] = useState<State>({ status: 'idle' });
  const run = useCallback((body: Body) => {
    setState({ status: 'loading' });
    understand(body)
      .then((result) => {
        setState({ status: 'done', result });
      })
      .catch((e: unknown) => {
        setState({ status: 'error', message: getErrorMessage(e, 'Flick could not do that.') });
      });
  }, []);
  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);
  return { state, run, reset };
}
