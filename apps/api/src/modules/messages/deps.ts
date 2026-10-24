import type { Db } from '../../db.js';

/** What the messages domain functions need. The WebSocket gateway passes the same thing. */
export interface MessageDeps {
  db: Db;
}
