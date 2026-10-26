// Only shortcuts that really exist in the app.
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'Enter', does: 'Send the message (or Ctrl/Cmd + Enter, see Chats)' },
  { keys: 'Ctrl/Cmd + Enter', does: 'Send the message in either mode' },
  { keys: 'Arrow Up (empty message box)', does: 'Edit your last message' },
  { keys: 'Esc', does: 'Cancel a reply or edit, close a dialog or menu' },
  { keys: 'Arrow Up / Down, then Enter', does: 'Pick a name from the @mention list' },
  { keys: 'Arrow keys, Enter', does: 'Move around and pick in the emoji grid' },
  { keys: 'Tab', does: 'Move between controls; the first one skips to the content' },
  { keys: 'Ctrl/Cmd + K', does: 'Open the command palette (jump to a chat or page)' },
  { keys: '?', does: 'Show this list of shortcuts' },
  { keys: '/', does: 'Search your chats' },
  { keys: 'Alt + N', does: 'Start a new chat' },
  { keys: 'Alt + Arrow Up / Down', does: 'Switch to the previous / next chat' },
];

/** What a global key press should do; null when it is not one of ours. Pure, so it is easy to test. */
export type ShortcutAction = 'palette' | 'help' | 'search' | 'newChat' | 'prevChat' | 'nextChat';

export const actionForKey = (
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  typing: boolean,
): ShortcutAction | null => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') return 'palette';
  if (e.altKey && e.key.toLowerCase() === 'n') return 'newChat';
  if (e.altKey && e.key === 'ArrowUp') return 'prevChat';
  if (e.altKey && e.key === 'ArrowDown') return 'nextChat';
  // Plain keys must not fire while someone is typing.
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === '?') return 'help';
  if (e.key === '/') return 'search';
  return null;
};
