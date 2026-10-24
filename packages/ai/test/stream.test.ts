import { describe, expect, it } from 'vitest';
import { AiStreamInterruptedError, AiUnavailableError } from '../src/errors.js';
import { GROQ_MODELS } from '../src/providers.js';
import type { AiRequest } from '../src/types.js';
import { buildChain, chunks, err, fail, KEYS, recordingMetrics, Script } from './helpers.js';

const REQ: AiRequest = { messages: [{ role: 'user', content: 'hello' }] };
const SONNET = 'claude-sonnet-5-5';
const G1 = GROQ_MODELS[0];

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of it) out.push(d);
  return out;
}

describe('stream()', () => {
  it('yields text deltas and reports provider/model', async () => {
    const script = new Script().on(KEYS.anthropic, SONNET, chunks(['Hel', 'lo', ' world']));
    const { chain } = buildChain(script);
    const s = chain.stream(REQ);
    expect(s.answer).toBeUndefined();
    expect(await collect(s)).toEqual(['Hel', 'lo', ' world']);
    await expect(s.info).resolves.toEqual({
      provider: 'anthropic',
      account: 'default',
      model: SONNET,
    });
    expect(s.answer?.model).toBe(SONNET);
    expect(script.calls[0]?.stream).toBe(true);
  });

  it('falls through when an entry fails before the first delta', async () => {
    const script = new Script()
      .on(
        KEYS.anthropic,
        SONNET,
        fail(() => err.anthropic(529, 'Overloaded', {}, 'overloaded_error')),
      )
      .on(KEYS.groq1, G1, chunks(['a', 'b']));
    const { chain } = buildChain(script);
    const s = chain.stream(REQ);
    expect(await collect(s)).toEqual(['a', 'b']);
    expect((await s.info).provider).toBe('groq');
  });

  it('falls through when the stream errors before any delta', async () => {
    const script = new Script().on(KEYS.anthropic, SONNET, chunks(['x'], { failAfter: 0 }));
    const { chain } = buildChain(script);
    const out = await collect(chain.stream(REQ));
    expect(out).toEqual([`ok:${KEYS.groq1}:${G1}`]);
  });

  it('a failure after deltas were delivered is surfaced, not retried elsewhere', async () => {
    const script = new Script().on(
      KEYS.anthropic,
      SONNET,
      chunks(['one', 'two', 'three'], { failAfter: 2 }),
    );
    const metrics = recordingMetrics();
    const { chain } = buildChain(script, {}, { metrics });
    const got: string[] = [];
    const e = await (async () => {
      for await (const d of chain.stream(REQ)) got.push(d);
    })().catch((x: unknown) => x);
    expect(got).toEqual(['one', 'two']);
    expect(e).toBeInstanceOf(AiStreamInterruptedError);
    expect(script.calls).toHaveLength(1);
    expect(metrics.attempts.map((a) => a.result)).toEqual(['success', 'stream_interrupted']);
  });

  it('all entries failing rejects with AiUnavailableError', async () => {
    const { chain } = buildChain(new Script(), {
      anthropicApiKey: undefined,
      groqApiKeys: [undefined, undefined],
      geminiApiKeys: [undefined, undefined],
    });
    await expect(collect(chain.stream(REQ))).rejects.toBeInstanceOf(AiUnavailableError);
  });
});
