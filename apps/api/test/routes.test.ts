import { ENDPOINTS, type Endpoint } from '@chat/contracts';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

// The web client builds its requests from ENDPOINTS, so every endpoint listed there must be a
// route the API really serves (same method, same path). Otherwise the call is a silent 404.
describe('contract endpoints', () => {
  it('are all registered as routes', async () => {
    const app = await testApp();
    const missing: string[] = [];
    for (const group of Object.values(ENDPOINTS)) {
      for (const endpoint of Object.values(group) as Endpoint[]) {
        const name = `${endpoint.method} ${endpoint.path}`;
        if (!app.hasRoute({ method: endpoint.method, url: endpoint.path })) {
          missing.push(name);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
