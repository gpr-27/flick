// The single toast outlet; features raise toasts through `notify` (notify.ts).
import { Toaster } from 'react-hot-toast';

export const AppToaster = () => (
  <Toaster
    position="top-center"
    containerStyle={{ top: 'calc(env(safe-area-inset-top) + 16px)' }}
    toastOptions={{
      duration: 3000,
      ariaProps: { role: 'status', 'aria-live': 'polite' },
      style: {
        background: 'var(--toast-bg)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        color: 'var(--toast-color)',
        border: '1px solid var(--toast-border)',
        borderRadius: '1rem',
        fontWeight: 600,
        boxShadow: 'var(--toast-shadow)',
      },
    }}
  />
);
