import type { AnalyzeMode } from '@chat/contracts';
import type { z } from 'zod';

type Mode = z.infer<typeof AnalyzeMode>;

/** One-tap actions: the instruction sent with the file(s). The file stays fenced untrusted data. */
export function modeInstruction(
  mode: Mode | undefined,
  language: string | undefined,
  fileCount: number,
): { question?: string; maxTokens?: number; extraSystem?: string } {
  switch (mode) {
    case 'table':
      return {
        maxTokens: 2500,
        question:
          'Extract the main table from this file. Reply with only a markdown table (header row, separator row, then rows) and nothing else. If there is no table, reply exactly: No table found.',
      };
    case 'translate': {
      const lang =
        (language ?? 'English').replace(/[^\p{L}\p{N} ()-]/gu, '').slice(0, 40) || 'English';
      return {
        maxTokens: 3000,
        question: `Translate all the text in this file into ${lang}. Reply with only the translation, keeping the original structure. If there is no text, say so.`,
      };
    }
    case 'highlight':
      return {
        maxTokens: 1200,
        question:
          'List the key terms in this document as short bullet points grouped under Dates, Amounts and Obligations (who must do what, by when). Quote exact wording briefly. Skip a group with nothing in it.',
      };
    case 'compare':
      return {
        maxTokens: 1500,
        question:
          fileCount > 1
            ? 'The files are two versions of the same thing (File 1 is older, File 2 is newer). List what changed: added, removed and changed, as short bullet points. Say if nothing changed.'
            : 'Only one file was given. Say that a second file is needed to compare versions.',
      };
    case 'receipt':
      return {
        maxTokens: 800,
        question:
          'Read this receipt. Reply with only a JSON object, no other text: {"merchant": string, "date": "YYYY-MM-DD" or "", "currency": string, "total": number or null, "items": [{"name": string, "price": number or null}]}. Use "" or null for anything not visible.',
      };
    default:
      return {};
  }
}
