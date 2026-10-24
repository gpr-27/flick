import { test, expect } from '@playwright/test';
import { bubble, openChat, send, signIn, startDirectChat, uniqueName } from './support';

// Journey (d): the server stores a message, but the answer ("ack") is lost on the way back and the
// connection drops. The sender cannot know whether it arrived, so the outbox sends it again with
// the SAME client_message_id. The server recognises that id and returns the message it already
// has, so there is still exactly one message.
test('a retry after a lost acknowledgement does not create a duplicate', async ({ browser }) => {
  const sentFrames: string[] = []; // client_message_id of every send_message the browser wrote
  let ackToDrop: string | null = null; // Socket.IO ack id of the next send_message
  let armed = false;

  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'), {
    // Sit between alice's page and the server and watch the Socket.IO frames.
    // A frame looks like `42<ackId>["send_message",{...}]`; its answer is `43<ackId>[...]`.
    beforeLoad: (page) =>
      page.routeWebSocket(/\/socket\.io\//, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((frame) => {
          if (typeof frame === 'string') {
            const send = /^42(\d+)\["send_message",(.*)\]$/.exec(frame);
            if (send) {
              sentFrames.push(/"client_message_id":"([^"]+)"/.exec(send[2] ?? '')?.[1] ?? '?');
              if (armed) {
                armed = false;
                ackToDrop = send[1] ?? null;
              }
            }
          }
          server.send(frame);
        });
        server.onMessage((frame) => {
          if (ackToDrop && typeof frame === 'string' && frame.startsWith(`43${ackToDrop}[`)) {
            // The server answered, but the answer never arrives and the connection dies.
            ackToDrop = null;
            void ws.close();
            void server.close();
            return;
          }
          ws.send(frame);
        });
      }),
  });

  await startDirectChat(alice.page, bob.name);
  await send(alice.page, 'first, to open the chat');
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'first, to open the chat')).toBeVisible();

  armed = true;
  await send(alice.page, 'only once please');

  // After the reconnect the outbox resends: two frames, one id.
  await expect.poll(() => sentFrames.length).toBe(3);
  expect(sentFrames[2]).toBe(sentFrames[1]);

  // Both people see exactly one copy.
  await expect(bubble(alice.page, 'only once please')).toHaveCount(1);
  await expect(bubble(bob.page, 'only once please')).toHaveCount(1);
  await expect(alice.page.getByRole('img', { name: 'Sending' })).toHaveCount(0);
});
