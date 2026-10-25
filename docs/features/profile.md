# Flick profile: how a name flows

Code: `apps/api/src/modules/users/` (server), `apps/web/src/features/profile/` and
`apps/web/src/features/auth/clerkProfileSync.ts` (web).

There are two copies of a person's name: Flick's (`users.display_name`, `username`, `avatar_url`)
and the one in the sign-in account at Clerk. Flick is the source of truth. A name can be changed in
either place and the other follows, so nobody has to change it twice.

## Flick to everyone else (live)

```
PATCH /users/me  ->  one transaction:
                       update users
                       if name, username or picture really changed:
                         one outbox row per conversation the user is in
                         (conversation.member_profile_changed, newest 200 conversations)
dispatcher       ->  user_updated {user_id, display_name, username, avatar_url}
                       to the current members of that conversation
```

- Members only: someone who left hears nothing. Nobody who blocked the user, or was blocked by
  them, gets the event. The user's own devices always do.
- Saving the same values again, or changing only "About", sends nothing.
- A person in more than 200 conversations tells the 200 most recently active ones; the rest read
  fresh data the next time they load the chat list or the members.
- `user_updated` takes no seq, so sync does not replay it (see `docs/architecture/protocol.md`).

The web client (`chatSession.ts` -> `useChatStore.userUpdated`) updates the member lists, the user
cache that message bubbles read sender names and pictures from, the `peer` of direct chats (the
chat list title and header), and a `profiles` overlay that the people directory and the contact
card lay over what they loaded earlier. The @mention list asks the server on every keystroke, so it
is always current.

## Flick to Clerk (after saving on the profile page)

After the API call succeeds, `pushProfileToClerk` updates the Clerk user: the display name is split
into first name (first word) and last name (the rest), the username is sent only if the Clerk user
has one (its own call, so a Clerk app without usernames cannot undo the name), and a new or removed
photo is copied with `setProfileImage`. If Clerk refuses, the Flick save stays and a small note is
shown. The profile page says: "Changing your name here also updates your sign-in account."

## Clerk to Flick (after using Clerk's account menu)

`useClerkProfileSync` (mounted while signed in) compares Clerk's name and username with a snapshot
this browser keeps in `localStorage` (`flick.clerkSync.v1`, per Flick user): the Clerk values at the
last sync.

- No snapshot yet (first load): remember Clerk as it is, copy nothing.
- Clerk differs from the snapshot: copy only the changed field to Flick (`PATCH /users/me`), when
  it is not blank, valid, and different from what Flick already has. Then take a new snapshot.
- Clerk equals the snapshot: nothing, so a name chosen in Flick is never overwritten by an
  unchanged Clerk account.
- The username is already taken on Flick (409): Flick keeps its own, a toast says why, the name is
  still copied, and Clerk's username is set back to Flick's.
- Any other failure is logged and not retried until Clerk changes again.

No loops: a push to Clerk takes a snapshot of what it wrote, and anything Clerk already shares with
Flick is never copied. Copying from Clerk never writes to Clerk (except the username put-back).

What is not synced: Clerk to Flick copies name and username only, not the picture. A picture
changed in Clerk's menu does not replace one set in Flick.
