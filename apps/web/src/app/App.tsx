import { Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import { ClerkLoading, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ConnectionStatusBanner } from '@/components/app/ConnectionStatusBanner';
import { FullScreenError, FullScreenLoader } from '@/components/app/FullScreenStates';
import { MobileTabBar } from '@/components/app/MobileTabBar';
import { Navbar } from '@/components/app/Navbar';
import { EdgeSwipeBack } from '@/app/EdgeSwipeBack';
import { useChromeStore } from '@/app/chromeStore';
import { useExitGuard } from '@/lib/useBackClose';
import { useChatStore } from '@/features/chat/useChatStore';
import { AppToaster } from '@/components/ui';
import { getTransport } from '@/lib/services';
import { setClerkBridge } from '@/features/auth/authBridge';
import { SignInPage } from '@/features/auth/components/SignInPage';
import { safeReturnTo } from '@/features/auth/returnTo';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CallOverlay } from '@/features/calls/components/CallOverlay';
import { CallPermissionPrompt } from '@/features/calls/components/CallPermissionPrompt';
import { IncomingCallModal } from '@/features/calls/components/IncomingCallModal';
import { useAnswerFromNotification } from '@/features/calls/useAnswerFromNotification';
import { bindCallRealtime } from '@/features/calls/useCallStore';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { GlobalKeys } from '@/features/palette/GlobalKeys';
import { GuideHost } from '@/features/guide/GuideHost';
import { InvitePage } from '@/features/chat/InvitePage';
import { CallLinkPage } from '@/features/groupcall/CallLinkPage';
import { GroupCallOverlay } from '@/features/groupcall/components/GroupCallOverlay';
import { startChatSession } from '@/features/chat/chatSession';
import { HomePage } from '@/features/chat/HomePage';
import { IncomingBanner } from '@/features/notifications/IncomingBanner';
import { useNotificationBindings } from '@/features/notifications/center/useNotificationBindings';
import { usePushLifecycle } from '@/features/notifications/usePushLifecycle';
import { useUnreadIndicators } from '@/features/notifications/useUnreadIndicators';
import { useOpenPendingConversation } from '@/features/notifications/useOpenPendingConversation';
import { AppLock } from '@/features/settings/components/AppLock';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { useThemeStore } from '@/features/settings/useThemeStore';
import { InstallGuide } from '@/pwa/InstallGuide';
import { ServerWakeNotice } from '@/features/serverWake/ServerWakeNotice';
import { OfflineNotice, UpdateBanner } from '@/pwa/PwaBanners';

// Heavy pages load when first visited, so the chat list opens faster.
const CallLogPage = lazy(() =>
  import('@/features/calllog/CallLogPage').then((m) => ({ default: m.CallLogPage })),
);
const PeoplePage = lazy(() =>
  import('@/features/directory/PeoplePage').then((m) => ({ default: m.PeoplePage })),
);
const ProfilePage = lazy(() =>
  import('@/features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const PublicProfilePage = lazy(() =>
  import('@/features/profile/PublicProfilePage').then((m) => ({ default: m.PublicProfilePage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SharePage = lazy(() => import('@/pwa/SharePage').then((m) => ({ default: m.SharePage })));
const BookmarksPage = lazy(() => import('@/features/productivity/BookmarksPage'));
const MemoryPage = lazy(() => import('@/features/ai/flick/MemoryPage'));
const NotificationsPage = lazy(() =>
  import('@/features/notifications/center/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
);

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

/** Clerk finished on /sign-in or /sign-up: go where the person was headed, else the app. */
const AfterSignIn = () => {
  const { search } = useLocation();
  return <Navigate to={safeReturnTo(search)} replace />;
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

  const { pathname } = useLocation();
  const chatOpen = useChatStore((st) => st.selectedId !== null);
  // The phone tab bar steps aside inside an open chat and on call-link pages.
  // It also steps aside inside a Settings section (a page of its own on phones).
  const hideForScreen = useChromeStore((st) => st.hideTabBar > 0);
  const showTabBar =
    !(chatOpen && pathname === '/') && !pathname.startsWith('/call/') && !hideForScreen;

  // Installed app: the first Back at the very start shows "Press back again to exit".
  useExitGuard();

  useRealtimeBindings(userId);
  useNotificationBindings(userId);
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
    <div className={showTabBar ? 'has-tabbar' : undefined}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-base-100 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <Navbar />
      {showTabBar && <MobileTabBar />}
      <ConnectionStatusBanner />
      <div id="main" tabIndex={-1} className="outline-none">
        <Suspense fallback={<FullScreenLoader />}>
          <Routes>
            <Route path="/sign-in/*" element={<AfterSignIn />} />
            <Route path="/sign-up/*" element={<AfterSignIn />} />
            <Route path="/" element={<HomePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/u/:username" element={<PublicProfilePage />} />
            <Route path="/calls" element={<CallLogPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/share" element={<SharePage />} />
            <Route path="/join/:code" element={<InvitePage />} />
            <Route path="/call/:token" element={<CallLinkPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </div>
      <IncomingBanner />
      <AppLock />
      <IncomingCallModal />
      <CallPermissionPrompt />
      <CallOverlay />
      <GroupCallOverlay />
      <GuideHost />
      <GlobalKeys />
      <EdgeSwipeBack />
    </div>
  );
};

export const App = () => {
  const { isSignedIn } = useAuth();
  const sessionReady = useSessionStore((s) => s.status === 'authenticated');
  const initTheme = useThemeStore((s) => s.initTheme);
  useClerkBridge();
  usePushLifecycle(Boolean(isSignedIn), Boolean(isSignedIn) && sessionReady);

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
      <ServerWakeNotice />
      <UpdateBanner />
      <InstallGuide />
    </div>
  );
};

export default App;
