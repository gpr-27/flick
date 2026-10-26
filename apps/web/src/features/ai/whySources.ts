export interface AiSources {
  messages: number;
  files: number;
  app_knowledge: boolean;
}

export const sourceLines = (s: AiSources): string[] => [
  `${s.messages} recent message${s.messages === 1 ? '' : 's'} from this chat`,
  ...(s.files > 0 ? [`${s.files} file${s.files === 1 ? '' : 's'} you sent`] : []),
  ...(s.app_knowledge ? ['Flick’s knowledge of the app and your settings'] : []),
];
