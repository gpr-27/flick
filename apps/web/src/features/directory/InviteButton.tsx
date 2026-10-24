import { UserPlus } from 'lucide-react';
import { cn } from '@/components/ui';
import { inviteFriends } from './inviteFriends';

export const InviteButton = ({ className }: { className?: string }) => (
  <button
    type="button"
    className={cn('btn btn-outline btn-primary btn-sm gap-2 rounded-full', className)}
    onClick={() => void inviteFriends()}
  >
    <UserPlus className="size-4" aria-hidden="true" />
    Invite friends
  </button>
);
