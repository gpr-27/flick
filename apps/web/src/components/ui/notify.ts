// Single toast entry point: features call `notify.*`, the app renders one
// <AppToaster/>, so the toast library is used in exactly two files.
import toastLib from 'react-hot-toast';

export const notify = {
  success: (message: string): string => toastLib.success(message),
  error: (message: string): string => toastLib.error(message),
  info: (message: string): string => toastLib(message),
};
