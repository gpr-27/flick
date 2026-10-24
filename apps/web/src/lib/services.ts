// Composition root registry. main.tsx wires the real implementations; stores and hooks resolve
// them here, and tests configure fakes.
import type { Api } from './api/endpoints';
import type { RealtimeTransport } from './realtime/transport';

export interface AppServices {
  api: Api;
  transport: RealtimeTransport;
}

let services: AppServices | null = null;

export const configureServices = (next: AppServices): void => {
  services = next;
};

const resolveServices = (): AppServices => {
  if (!services)
    throw new Error('App services are not configured; call configureServices() at startup.');
  return services;
};

export const getApi = (): Api => resolveServices().api;
export const getTransport = (): RealtimeTransport => resolveServices().transport;
