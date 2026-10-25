// Each feature lives in src/modules/<name>/ with up to four folders:
//   domain/  pure logic, no Fastify/SQL/Redis, so it is easy to unit test
//   repo/    SQL queries and transactions (Kysely)
//   http/    Fastify routes: validate input, call domain + repo
//   ws/      WebSocket message handlers
// A module exports one function `(app, deps) => void` and is listed below.
import { callRoutes } from './calls/index.js';
import { aiRoutesModule } from './ai/routes.js';
import { conversationRoutes } from './conversations/http/routes.js';
import { deviceRoutes } from './devices/http/routes.js';
import { extrasRoutes } from './extras/http/routes.js';
import { healthRoutes } from './health/http/routes.js';
import { userRoutes } from './users/http/routes.js';
import { mediaRoutes } from './media/http/routes.js';
import { messageRoutes } from './messages/index.js';
import { notificationRoutes } from './notifications/routes.js';
import { pushRoutes } from './push/routes.js';
import { reminderRoutes } from './reminders/http/routes.js';
import { scheduledRoutes } from './scheduled/http/routes.js';

export const modules = [
  healthRoutes,
  mediaRoutes,
  extrasRoutes,
  messageRoutes,
  conversationRoutes,
  callRoutes,
  pushRoutes,
  notificationRoutes,
  aiRoutesModule,
  userRoutes,
  scheduledRoutes,
  reminderRoutes,
  deviceRoutes,
];
