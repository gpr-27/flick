// Composition root. Imports config first so a bad VITE_* variable fails fast with a clear
// message, then wires Clerk, the API client and the Socket.IO transport.
import { config } from '@/config/env';
import { ClerkProvider } from '@clerk/clerk-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { createApi, createApiClient } from '@/lib/api';
import { logger } from '@/lib/logger';
import { createSocketTransport } from '@/lib/realtime/socketTransport';
import { configureServices } from '@/lib/services';
import { getDeviceId, getSessionToken, signOutOfClerk } from '@/features/auth/authBridge';
import { getSocketAuth } from '@/features/auth/socketAuth';
import { bindSignOutReset } from '@/features/chat/chatSession';
import { App } from '@/app/App';
import { startPwa } from '@/pwa/register';
import './index.css';

const api = createApi(
  createApiClient({
    baseUrl: config.apiUrl,
    getToken: getSessionToken,
    getDeviceId,
    headers: config.http.tunnelHeaders,
    // The server rejected the Clerk token: the session is over.
    onUnauthorized: () => {
      void signOutOfClerk();
    },
    onError: (error, { method, path }) => {
      if (error.status === 0) logger.error('Network error:', method, path);
      else logger.error(`API error ${error.status}: ${method} ${path}`, error.message);
    },
  }),
);

const transport = createSocketTransport({
  url: config.socketUrl,
  getAuth: getSocketAuth,
  onUnauthorized: () => {
    void signOutOfClerk();
  },
});

configureServices({ api, transport });
bindSignOutReset();
startPwa();

const container = document.getElementById('root');
if (!container) throw new Error(`#root element missing (env: ${config.env})`);

createRoot(container).render(
  <StrictMode>
    <ClerkProvider publishableKey={config.clerkPublishableKey}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ClerkProvider>
  </StrictMode>,
);
