import { notify } from '@/components/ui';

/** Share the app link: the phone's share sheet if there is one, otherwise copy it. */
export const inviteFriends = async (): Promise<void> => {
  const data = { title: 'Flick', text: 'Chat with me on Flick', url: location.origin };
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return;
    } catch (error) {
      // The person closed the share sheet: nothing more to do. Any other failure: copy instead.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    notify.success('Link copied. Send it to a friend!');
  } catch {
    notify.info(`Share this link: ${data.url}`);
  }
};
