// Only shortcuts that really exist in the app.
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'Enter', does: 'Send the message (or Ctrl/Cmd + Enter, see Chats)' },
  { keys: 'Ctrl/Cmd + Enter', does: 'Send the message in either mode' },
  { keys: 'Arrow Up (empty message box)', does: 'Edit your last message' },
  { keys: 'Esc', does: 'Cancel a reply or edit, close a dialog or menu' },
  { keys: 'Arrow Up / Down, then Enter', does: 'Pick a name from the @mention list' },
  { keys: 'Arrow keys, Enter', does: 'Move around and pick in the emoji grid' },
  { keys: 'Tab', does: 'Move between controls; the first one skips to the content' },
];
