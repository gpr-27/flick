// Slash commands in the composer: "/poll", "/remind", "/schedule", "/flick".

export type SlashName = 'poll' | 'remind' | 'schedule' | 'flick';

export interface SlashCommand {
  name: SlashName;
  hint: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'poll', hint: 'Create a poll' },
  { name: 'remind', hint: 'Remind me about this chat' },
  { name: 'schedule', hint: 'Schedule a message' },
  { name: 'flick', hint: 'Write with Flick' },
];

/** The commands that fit what is typed so far ("/re" gives remind), while it is only "/word". */
export const matchSlash = (text: string): SlashCommand[] => {
  const typed = /^\/([a-z]*)$/i.exec(text);
  if (!typed) return [];
  const prefix = (typed[1] ?? '').toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));
};

/** "/remind call mom" gives { name: 'remind', arg: 'call mom' }; null if it is not a command. */
export const parseSlash = (text: string): { name: SlashName; arg: string } | null => {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  const name = m?.[1]?.toLowerCase();
  const command = SLASH_COMMANDS.find((c) => c.name === name);
  return command ? { name: command.name, arg: (m?.[2] ?? '').trim() } : null;
};
