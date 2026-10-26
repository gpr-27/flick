import { ErrorState, Spinner } from '@/components/ui';

export const FullScreenLoader = () => (
  <div className="app-bg flex h-dvh-screen items-center justify-center" aria-busy="true">
    <Spinner size="lg" label="Loading Flick" />
  </div>
);

interface FullScreenErrorProps {
  title: string;
  message: string;
  onRetry: () => void;
  retrying: boolean;
}

export const FullScreenError = ({ title, message, onRetry, retrying }: FullScreenErrorProps) => (
  <main className="app-bg flex min-h-dvh-screen items-center justify-center px-6 py-6">
    <ErrorState
      variant="card"
      title={title}
      message={message}
      onRetry={onRetry}
      retrying={retrying}
    />
  </main>
);
