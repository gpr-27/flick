// Single toast entry point: features call `notify.*`, the app renders one
// <AppToaster/>, so the toast library is used in exactly two files.
import { createElement } from 'react';
import toastLib from 'react-hot-toast';

export const notify = {
  success: (message: string): string => toastLib.success(message),
  error: (message: string): string => toastLib.error(message),
  info: (message: string): string => toastLib(message),
  /** A message with one button, e.g. "Chat archived  [Undo]". The toast stays a little longer. */
  withAction: (message: string, actionLabel: string, onAction: () => void): string =>
    toastLib(
      (t) =>
        createElement(
          'span',
          { className: 'flex items-center gap-3' },
          message,
          createElement(
            'button',
            {
              type: 'button',
              className: 'btn btn-primary btn-xs min-h-[32px]',
              onClick: () => {
                toastLib.dismiss(t.id);
                onAction();
              },
            },
            actionLabel,
          ),
        ),
      { duration: 6000 },
    ),
};
