import { useEffect, useLayoutEffect } from 'react';
import { ClerkLoading, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ConnectionStatusBanner } from '@/components/app/ConnectionStatusBanner';
import { FullScreenError, FullScreenLoader } from '@/components/app/FullScreenStates';
import { Navbar } from '@/components/app/Navbar';
import { AppToaster } from '@/components/ui';
import { getTransport } from '@/lib/services';
import { setClerkBridge } from '@/features/auth/authBridge';
import { SignInPage } from '@/features/auth/components/SignInPage';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CallOverlay } from '@/features/calls/components/CallOverlay';
import { CallPermissionPrompt } from '@/features/calls/components/CallPermissionPrompt';
import { IncomingCallModal } from '@/features/calls/components/IncomingCallModal';
import { useAnswerFromNotification } from '@/features/calls/useAnswerFromNotification';
import { bindCallRealtime } from '@/features/calls/useCallStore';
import { CallLogPage } from '@/features/calllog/CallLogPage';
import { InvitePage } from '@/features/chat/InvitePage';
import { CallLinkPage } from '@/features/groupcall/CallLinkPage';
import { GroupCallOverlay } from '@/features/groupcall/components/GroupCallOverlay';
import { startChatSession } from '@/features/chat/chatSession';
import { HomePage } from '@/features/chat/HomePage';
import { IncomingBanner } from '@/features/notifications/IncomingBanner';
import { useUnreadIndicators } from '@/features/notifications/useUnreadIndicators';
import { useOpenPendingConversation } from '@/features/notifications/useOpenPendingConversation';
import { PeoplePage } from '@/features/directory/PeoplePage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { PublicProfilePage } from '@/features/profile/PublicProfilePage';
import { AppLock } from '@/features/settings/components/AppLock';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { useThemeStore } from '@/features/settings/useThemeStore';
import { InstallGuide } from '@/pwa/InstallGuide';
import { OfflineNotice, UpdateBanner } from '@/pwa/PwaBanners';

/** Wire chat and call events to the transport for as long as someone is signed in. */
const useRealtimeBindings = (userId: string | undefined): void => {
  useEffect(() => {
    if (!userId) return;
    const stopChat = startChatSession(userId);
    const stopCalls = bindCallRealtime(getTransport());
    return () => {
      stopChat();
      stopCalls();
    };
  }, [userId]);
};

/** Hand Clerk's getToken / signOut to the plain modules (API client, socket). */
const useClerkBridge = (): void => {
  const { getToken, signOut } = useAuth();
  useLayoutEffect(() => {
    setClerkBridge({ getToken: () => getToken(), signOut: () => signOut() });
    return () => {
      setClerkBridge(null);
    };
  }, [getToken, signOut]);
};

/** Everything a signed-in user sees. Mounted only while Clerk says signed in. */
const SignedInApp = () => {
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.user?.id);
  const error = useSessionStore((s) => s.error);

  useEffect(() => {
    void useSessionStore.getState().load();
    return () => {
      getTransport().disconnect();
      useSessionStore.getState().reset();
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') getTransport().connect();
  }, [status]);

  useRealtimeBindings(userId);
  useOpenPendingConversation();
  useUnreadIndicators();
  useAnswerFromNotification(status === 'authenticated');

  if (status !== 'authenticated') {
    return error ? (
      <FullScreenError
        title="Can't reach Flick"
        message={error}
        retrying={false}
        onRetry={() => void useSessionStore.getState().load()}
      />
    ) : (
      <FullScreenLoader />
    );
  }
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-base-100 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <Navbar />
      <ConnectionStatusBanner />
      <div id="main" tabIndex={-1} className="outline-none">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/calls" element={<CallLogPage />} />
          <Route path="/join/:code" element={<InvitePage />} />
          <Route path="/call/:token" element={<CallLinkPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
      <IncomingBanner />
      <AppLock />
      <IncomingCallModal />
      <CallPermissionPrompt />
      <CallOverlay />
      <GroupCallOverlay />
    </>
  );
};

export const App = () => {
  const initTheme = useThemeStore((s) => s.initTheme);
  useClerkBridge();

  // Re-assert the persisted theme on the DOM (safety net for the no-flash script).
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return (
    <div className="min-h-dvh-screen bg-base-200 font-sans text-base-content">
      <ClerkLoading>
        <FullScreenLoader />
      </ClerkLoading>
      <SignedOut>
        <ThemeToggle variant="floating" className="right-4 top-4 z-50" />
        <SignInPage />
      </SignedOut>
      <SignedIn>
        <SignedInApp />
      </SignedIn>
      <AppToaster />
      <OfflineNotice />
      <UpdateBanner />
      <InstallGuide />
    </div>
  );
};

export default App;
