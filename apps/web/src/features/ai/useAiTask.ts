import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@/lib/api';
import { isNotConfigured } from './aiApi';

export interface AiTaskState {
  status: 'idle' | 'loading' | 'done' | 'error';
  /** The answer so far (grows while a stream is loading). */
  text: string;
  error: string | null;
  notConfigured: boolean;
}

const IDLE: AiTaskState = { status: 'idle', text: '', error: null, notConfigured: false };

/**
 * One AI request at a time: loading, streamed text, error. Starting a new run (or unmounting)
 * cancels the one in flight. `run` resolves with the final text, or null if it failed or was cancelled.
 */
export const useAiTask = () => {
  const [state, setState] = useState<AiTaskState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (
      call: (options: { signal: AbortSignal; onText: (text: string) => void }) => Promise<string>,
    ): Promise<string | null> => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      setState({ ...IDLE, status: 'loading' });
      try {
        const text = await call({
          signal: mine.signal,
          onText: (partial) => {
            if (!mine.signal.aborted) setState({ ...IDLE, status: 'loading', text: partial });
          },
        });
        if (mine.signal.aborted) return null;
        setState({ ...IDLE, status: 'done', text });
        return text;
      } catch (error) {
        if (mine.signal.aborted) return null;
        setState({
          ...IDLE,
          status: 'error',
          error: getErrorMessage(error, 'Flick could not answer. Try again.'),
          notConfigured: isNotConfigured(error),
        });
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    setState(IDLE);
  }, []);

  return { state, run, reset };
};
