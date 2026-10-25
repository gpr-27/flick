// Settings > Guide and tips: every topic by area with its status, a "Show me" button for each, the
// full tour again, the switch for tips, and a way to start over.
import { useNavigate } from 'react-router-dom';
import { notify } from '@/components/ui/notify';
import { ActionButton, Card, ToggleRow } from '@/features/settings/components/controls';
import { WELCOME_ID, topicsByArea, type GuideTopic } from './catalog';
import { useGuideStore } from './useGuideStore';

type Status = 'new' | 'seen' | 'used';

const STATUS_LABEL: Record<Status, string> = { new: 'New', seen: 'Seen', used: 'Used' };
const STATUS_CLASS: Record<Status, string> = {
  new: 'bg-primary/15 text-primary',
  seen: 'bg-base-content/10 text-base-content/70',
  used: 'bg-success/15 text-success',
};

export const GuideSettings = () => {
  const navigate = useNavigate();
  const seen = useGuideStore((s) => s.seen);
  const used = useGuideStore((s) => s.used);
  const welcomeDoneAt = useGuideStore((s) => s.welcomeDoneAt);
  const enabled = useGuideStore((s) => s.enabled);
  const { replay, setEnabled, reset } = useGuideStore.getState();

  const statusOf = (topic: GuideTopic): Status => {
    if (topic.id in used) return 'used';
    if (topic.id in seen || (topic.id === WELCOME_ID && welcomeDoneAt)) return 'seen';
    return 'new';
  };

  const show = (id: string): void => {
    // Leave Settings first so the tour can point at the real screen.
    navigate('/');
    window.setTimeout(() => {
      replay(id);
    }, 0);
  };

  return (
    <div className="space-y-4">
      <Card title="Guide and tips">
        <div className="flex min-h-[44px] items-center justify-between gap-4 py-1">
          <span>
            <span className="block font-semibold">Take the full tour again</span>
            <span className="block text-sm text-base-content/60">
              A one-minute walk through the whole app.
            </span>
          </span>
          <ActionButton
            onClick={() => {
              show(WELCOME_ID);
            }}
          >
            Take the tour
          </ActionButton>
        </div>
        <ToggleRow
          label="Show tips as I use new features"
          hint="The first time you open something new, a short tip shows how to use it."
          checked={enabled}
          onChange={setEnabled}
        />
        <div className="flex min-h-[44px] items-center justify-between gap-4 py-1">
          <span>
            <span className="block font-semibold">Reset the guide</span>
            <span className="block text-sm text-base-content/60">
              Forget what you have seen, so every tip and the tour can show again.
            </span>
          </span>
          <ActionButton
            tone="danger"
            onClick={() => {
              reset();
              notify.success('The guide was reset.');
            }}
          >
            Reset
          </ActionButton>
        </div>
      </Card>

      {topicsByArea().map((group) => (
        <Card key={group.area} title={group.label}>
          <ul className="divide-y divide-base-content/10">
            {group.topics.map((topic) => {
              const status = statusOf(topic);
              return (
                <li key={topic.id} className="flex min-h-[44px] items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 font-semibold">{topic.title}</span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium ${STATUS_CLASS[status]}`}
                  >
                    <span className="sr-only">Status: </span>
                    {STATUS_LABEL[status]}
                  </span>
                  <ActionButton
                    onClick={() => {
                      show(topic.id);
                    }}
                  >
                    <span aria-hidden="true">Show me</span>
                    <span className="sr-only">Show me {topic.title}</span>
                  </ActionButton>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
};
