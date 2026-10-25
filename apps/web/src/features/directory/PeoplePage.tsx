import { useNavigate } from 'react-router-dom';
import { useChatStore } from '@/features/chat/useChatStore';
import { useFeatureGuide } from '@/features/guide/useFeatureGuide';
import { markUsed } from '@/features/guide/useGuideStore';
import { PeopleDirectory } from './PeopleDirectory';

/** Everyone on Flick, full screen. Picking someone opens the chat with them. */
export const PeoplePage = () => {
  const navigate = useNavigate();
  const openDirect = useChatStore((s) => s.openDirect);
  useFeatureGuide('people.directory');
  return (
    <main className="app-bg relative flex h-dvh-screen flex-col overflow-hidden pt-[calc(4rem+env(safe-area-inset-top))]">
      <div className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col p-4">
        <div className="glass-card flex min-h-0 flex-1 flex-col rounded-3xl p-4 sm:p-6">
          <h1 className="mb-4 font-display text-2xl font-bold">People</h1>
          <PeopleDirectory
            actionLabel={(u) => `Chat with ${u.display_name}`}
            listClassName="min-h-0 flex-1"
            onPick={(user) => {
              markUsed('people.directory');
              void openDirect(user.id).then(() => {
                navigate('/');
              });
            }}
          />
        </div>
      </div>
    </main>
  );
};

export default PeoplePage;
