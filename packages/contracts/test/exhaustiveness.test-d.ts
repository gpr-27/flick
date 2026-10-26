// Compile-time check: if a content type is added without a case here,
// `assertNever` gets a non-never argument and typecheck fails.
import { expectTypeOf, it } from 'vitest';
import { type MessageContent, assertNever } from '../src/index.js';

function content(c: MessageContent): string {
  switch (c.type) {
    case 'text':
      return c.text;
    case 'image':
    case 'video':
    case 'file':
    case 'voice':
      return c.attachment_id;
    case 'gif':
      return c.gif_id;
    case 'sticker':
      return c.sticker_id;
    case 'poll':
      return c.question;
    case 'poll_vote':
      return c.poll_message_id;
    case 'system':
      return c.event;
    case 'call_event':
      return c.outcome;
    case 'checklist':
      return c.title;
    case 'expense':
      return c.description;
    case 'game':
      return c.game;
    case 'event':
      return c.title;
    default:
      return assertNever(c);
  }
}

it('every switch is exhaustive', () => {
  expectTypeOf(content).returns.toEqualTypeOf<string>();
});
