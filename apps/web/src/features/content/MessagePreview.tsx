import { RichText } from './richText/RichText';

/** How the message will look once sent: drawn by the same renderer the chat uses. */
export const MessagePreview = ({ text }: { text: string }) => (
  <div
    aria-label="Message preview"
    role="region"
    className="mb-2 max-h-48 overflow-y-auto break-words rounded-xl bg-base-content/5 px-3 py-2 text-sm"
  >
    {text.trim() ? (
      <RichText text={text} />
    ) : (
      <span className="text-base-content/50">Nothing to preview yet.</span>
    )}
  </div>
);
