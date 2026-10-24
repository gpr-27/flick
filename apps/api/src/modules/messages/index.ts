// The messages module: send, history, sync, edit/delete/react, receipts, search, pins, stars,
// polls and view-once. The WebSocket gateway imports the plain functions below and calls them
// from its frame handlers, so REST and WebSocket share one implementation.
export { messageRoutes } from './http/routes.js';
export type { MessageDeps } from './deps.js';
export { ApiError, toApiError } from './errors.js';
export { sendMessage } from './domain/send.js';
export { syncMany, syncConversation } from './domain/sync.js';
export { acknowledgeDelivered, acknowledgeRead, getMessageInfo } from './domain/receipts.js';
