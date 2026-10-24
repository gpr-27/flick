/**
 * How the message will look once sent. This is the one place the composer needs the shared
 * message renderer (headings, lists, code, tables) from features/chat; until that lands in this
 * branch it shows the text as typed, with its line breaks. At merge: render `text` with the
 * renderer here and nothing else changes.
 */
export const MessagePreview = ({ text }: { text: string }) => (
  <div
    aria-label="Message preview"
    role="region"
    className="mb-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-base-content/5 px-3 py-2 text-sm"
  >
    {text.trim() ? text : <span className="text-base-content/50">Nothing to preview yet.</span>}
  </div>
);
