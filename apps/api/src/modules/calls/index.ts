// Calls: TURN credentials and the call log for 1:1 WebRTC calls, LiveKit tokens and call links
// for group calls. The gateway calls recordCall when a 1:1 call ends.
export { callRoutes } from './http/routes.js';
export { recordCall, type RecordCallInput } from './repo/call-log.js';
