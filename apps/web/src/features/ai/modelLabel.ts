const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  groq: 'Groq',
  gemini: 'Gemini',
};

/** "Anthropic · claude-haiku-5-5": which company's model wrote an AI answer. */
export const modelLabel = (provider: string, model: string): string => {
  const name = PROVIDER_NAMES[provider] ?? provider;
  return `${name} · ${model}`;
};
