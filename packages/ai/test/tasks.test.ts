import { describe, expect, it } from 'vitest';
import { AiTasks, parseReplies } from '../src/tasks.js';
import { buildChain, KEYS, Script, text } from './helpers.js';

const SONNET = 'claude-sonnet-5-5';

describe('parseReplies', () => {
  it('accepts plain and fenced JSON', () => {
    expect(parseReplies('{"replies":["Yes!","Maybe later","No thanks"]}')).toEqual([
      'Yes!',
      'Maybe later',
      'No thanks',
    ]);
    expect(parseReplies('```json\n{"replies": ["a", "b", "c", "d"]}\n```')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('AiTasks', () => {
  it('suggestReplies returns 3 replies with provider/model and falls through on bad JSON', async () => {
    const script = new Script()
      .on(KEYS.anthropic, SONNET, text('Here are some ideas: yes, no, maybe'))
      .on(
        KEYS.groq1,
        'openai/gpt-oss-120b',
        text('{"replies":["Sounds good","What time?","Can\'t tomorrow"]}'),
      );
    const { chain } = buildChain(script);
    const r = await new AiTasks(chain).suggestReplies([
      { sender: 'Ravi', text: 'Lunch tomorrow?' },
    ]);
    expect(r).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-120b' });
    expect(r.replies).toEqual(['Sounds good', 'What time?', "Can't tomorrow"]);
  });

  it('summarizeUnread / translate / chat return text and who answered', async () => {
    const script = new Script().on(KEYS.anthropic, SONNET, text('- Asha: meet at 5'));
    const { chain } = buildChain(script);
    const t = new AiTasks(chain);
    await expect(t.summarizeUnread([{ sender: 'Asha', text: 'meet at 5' }])).resolves.toMatchObject(
      {
        provider: 'anthropic',
        model: SONNET,
        text: '- Asha: meet at 5',
      },
    );
    await expect(t.translate('hola', 'English')).resolves.toMatchObject({ provider: 'anthropic' });
    await expect(t.chat([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      provider: 'anthropic',
    });
  });
});
