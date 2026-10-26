/** Longest instruction the write box takes (the contract allows this much for "write"). */
export const MAX_WRITE_PROMPT = 2_000;

/** What a "@flick <instruction>" message asks for, or null when it is not that. */
export const flickInstruction = (text: string): string | null => {
  const match = /^\s*@flick\s+(\S[\s\S]*)$/i.exec(text);
  const instruction = match?.[1]?.trim();
  return instruction && instruction.length <= MAX_WRITE_PROMPT ? instruction : null;
};
