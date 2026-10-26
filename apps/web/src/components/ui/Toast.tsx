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
        color: 'var(--toast-color)',
        border: '1px solid var(--toast-border)',
        borderRadius: '0.75rem',
        fontWeight: 500,
        fontSize: '0.875rem',
        padding: '0.75rem 1rem',
        boxShadow: 'var(--shadow-2)',
      },
      success: { iconTheme: { primary: '#43d6a3', secondary: '#1d1a2f' } },
      error: { iconTheme: { primary: '#ff7a92', secondary: '#1d1a2f' } },
    }}
  />
);
