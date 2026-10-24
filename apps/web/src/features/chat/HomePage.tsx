import { cn } from '@/components/ui';
import { ChatContainer } from './components/ChatContainer';
import { NoChatSelected } from './components/NoChatSelected';
import { Sidebar } from './components/Sidebar';
import { useChatStore } from './useChatStore';

export const HomePage = () => {
  const selected = useChatStore((s) => (s.selectedId ? s.conversations[s.selectedId] : undefined));

  return (
    <main
      className={cn(
        'app-bg relative h-dvh-screen overflow-hidden',
        // On a phone the top bar is hidden while a chat is open, so the chat uses that room too.
        selected
          ? 'pt-[env(safe-area-inset-top)] sm:pt-[calc(4rem+env(safe-area-inset-top))]'
          : 'pt-[calc(4rem+env(safe-area-inset-top))]',
      )}
    >
      <div className="blobs" aria-hidden="true" />

      <div className="relative mx-auto flex h-full max-w-7xl px-0 sm:px-4 sm:pb-4">
        <div className="glass-card mx-auto mt-0 flex w-full overflow-hidden sm:mt-2 sm:rounded-3xl">
          {/* Chat list: full screen on mobile until a chat is opened */}
          <div className={cn('w-full shrink-0 sm:flex sm:w-80', selected ? 'hidden' : 'flex')}>
            <Sidebar />
          </div>

          {/* Conversation: full screen on mobile only when a chat is open */}
          <div className={cn('min-w-0 flex-1', selected ? 'flex' : 'hidden sm:flex')}>
            {selected ? (
              <ChatContainer key={selected.id} conversation={selected} />
            ) : (
              <NoChatSelected />
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

export default HomePage;
