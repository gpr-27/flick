# Groups

A group is a chat with up to 1,024 members, roles (owner, admin, member), a name, a photo and a description, and a set of admin tools: announcement-only mode, slow mode, a welcome-and-rules text, join approval, invite links, join requests, call links, a flagged-message scan, activity numbers, and (with AI on) a mood summary and an icebreaker for quiet groups. Members can also start group calls, share polls, checklists and expense splits. This page lists what each tool does, how to reach it, and what is not built. Code: `apps/web/src/features/{chat/components/GroupInfoModal.tsx,grouptools}`, `apps/api/src/modules/{conversations,grouptools}`.

Related: [messaging.md](messaging.md) | [rich-messages.md](rich-messages.md) | [calls.md](calls.md) | [safety-and-privacy.md](safety-and-privacy.md) | [integrations.md](integrations.md) | [chat-list.md](chat-list.md) | [../ai/productivity-and-safety.md](../ai/productivity-and-safety.md) | [../ai/conversation-understanding.md](../ai/conversation-understanding.md) | [../ai/README.md](../ai/README.md)

## Limits

| What                                | Limit                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Members in a group                  | 1,024 (`LIMITS.MAX_GROUP_MEMBERS`)                                                                         |
| People chosen when creating a group | up to 255 plus you                                                                                         |
| Group name                          | 1 to 100 characters                                                                                        |
| Description                         | up to 500 characters                                                                                       |
| Welcome and rules text              | up to 1,000 characters                                                                                     |
| Invite link lifetime (API)          | 60 seconds to 30 days; max uses 1 to 1,024. The app creates links with no expiry and no use limit.         |
| Groups up to 256 members            | other members' read marks are sent in the chat summary; bigger groups get read marks from live events only |
| Pinned chats in the chat list       | 3 (personal setting, not group specific)                                                                   |

## Creating a group and managing members

**How to use it.** New group (from the new-chat menu in the sidebar): a group name and the people, then "Create group". Open the group info panel (the info button in the chat header) to change the name, description and photo, add members ("Add members"), remove members, and change roles. The panel has two tabs: "Info" (members and settings) and "Media, links and files" (Media, Links, Docs, Voice).

**Roles.**

| Role   | Can do                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner  | everything; removes anyone; demotes admins; leaves with the oldest admin (or else the oldest member) taking over                                                          |
| Admin  | adds and removes plain members, promotes members ("Make admin"), turns the group switches, handles join requests, makes invite and call links, uses the admin tools below |
| Member | sends messages (unless announcement-only), may edit name, description and photo unless that is admins-only; cannot add or remove people                                   |

Rules in `conversations/domain/roles.ts`: nobody changes the owner's role or makes a second owner; only the owner demotes an admin; an admin cannot remove another admin.

Adding someone fails with a per-person reason: not found, blocked, the person's privacy settings forbid it, already in, or group full.

**Status: Built.**
Gap: ownership cannot be handed over on purpose; it moves only when the owner leaves. No separate "moderator" role.

## Group settings (admin switches)

Group info, "Group settings" (admins only):

| Switch                                      | Effect                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Only admins can send messages               | Announcement-only. Members get an error when sending; owner and admins can post. Checked on the server at send time (`ADMINS_ONLY`). |
| Only admins can edit group info             | Members cannot change name, photo or description.                                                                                    |
| Admins approve new members who join by link | Joining by invite link creates a join request instead of adding the person.                                                          |

The disappearing-message timer for the group (Off, 24 hours, 7 days, 90 days) is set from the chat header and is also an admin setting in groups. See [messaging.md](messaging.md).

**Status: Built.**

## Slow mode

**What it does.** Members must wait between their messages. Admins and the owner are exempt.

**How to use it.** Group info, "Slow mode", choose Off, 10 seconds, 30 seconds, 1 minute or 5 minutes. When a member sends too soon, the server answers `SLOW_MODE` with the seconds to wait ("Slow mode is on. Wait 12s to send again."). The wait is counted from the member's last message in that group.

**Status: Built.**

## Welcome text and rules

**What it does.** One text field, "Welcome message and rules" (up to 1,000 characters, markdown allowed), saved on the group.

**How to use it.** Admins edit it in group info and press "Save welcome text". Members see it under the heading "Welcome and rules" when they open group info.

**Status: Partial.**
Gap: the text is not posted into the chat when someone joins and not shown in a pop-up; members only see it if they open group info. The field's hint text says "Shown to new members when they join", which is more than the app does today. There is no separate rules field.

## Join requests, invite links, call links

**Invite links.** Group info, "Create invite link" (admins). The link looks like `<site>/join/<code>`. Copy it, "Reset link" (makes a new one first, then revokes the old one) or "Revoke". The server stores only a hash of the code, so a link can be shown only while the panel remembers it; after a reload use "Reset link". A person who opens the link sees the group name, photo and member count and taps to join; If approval is on, the button reads "Request to join" and they become a join request instead.

**Join requests.** Group info shows a "Join requests" list for admins, with Approve and Deny per person and "Approve all" and "Reject all". A badge counts waiting requests.

**Call links.** Group info, call link section (admins): a link that lets a signed-in person join the group's LiveKit call without joining the chat. See [calls.md](calls.md).

**Status: Built.**
Gap: the app does not offer expiry or use limits for invite links, although the API supports them.

## Flagged messages

**What it does.** Lists recent messages that look rude or spammy, so admins can delete them.

**How to use it.** Admins, group info, "Flagged messages", "Scan recent messages". The server looks at the last 300 text messages and returns up to 30 that match simple rules (`grouptools/flagging.ts`): a short list of rude words, spam phrases, text that is nearly all capitals, three or more links, or a character repeated ten times. Each result shows the sender, the text (first 300 characters), and the reasons. A Delete button removes it for everyone.

**Status: Built (simple rules, no AI).**
Gap: this is a word-list check, not a smart filter. It will miss subtle abuse and flag some harmless messages, and only covers text messages. Nothing is flagged automatically; an admin must press scan.

AI: separately, the group AI endpoint has a `flag` task (an AI scan for rude, harassing or spam messages), but the group info screen does not call it. See [../ai/productivity-and-safety.md](../ai/productivity-and-safety.md).

## Analytics

**What it does.** Activity numbers for the last 30 days: total messages, the top 5 senders, the 24 busiest hours (UTC) as a bar chart, and the time of the last message. System and call lines are not counted. Admins only, from group info ("Activity (last 30 days)").

**Status: Built.**
Gap: hours are in UTC, not the viewer's time zone; there is no export and no per-day history.

## Mood summary and icebreaker (AI)

- **Weekly mood summary** (admins, group info): asks Flick for a four-point summary of the group's tone, main topics and any tension, from up to 150 recent messages (at most 12,000 characters, 400 per message).
- **Quiet group icebreaker**: when the last message is older than 3 days and AI is on, group info offers "Suggest an icebreaker" (any member). You can send the suggestion to the group.

**Status: Built.**

AI: both are AI features, read-only on your messages, and the chat text is treated as untrusted data. See [../ai/productivity-and-safety.md](../ai/productivity-and-safety.md) and [../ai/privacy-and-limits.md](../ai/privacy-and-limits.md).

## Shared tools in groups

The Chat tools button in the header adds group-only items: "Find a time" poll and "Split an expense" (balances show in group info). Checklists and games also work in 1:1 chats. See [rich-messages.md](rich-messages.md).

## Mentions and notifications

`@name` mentions notify people even if the group is muted. `@everyone` is offered in groups but only the first 100 non-bot members are included, so large groups are only partly covered. See [messaging.md](messaging.md) and [notifications.md](notifications.md).

## Group calls

The "Start group call" button (in groups only) starts or joins a call on LiveKit; admins can create call links. A banner "A group call is in progress" with Join call shows above the messages while people are in the call. See [calls.md](calls.md).

## Webhooks

Group info shows a Webhooks section for admins, which is covered in [integrations.md](integrations.md).

## Leaving and deleting

"Leave this group?" asks for confirmation, then you stop getting its messages. When the owner leaves, ownership passes to the oldest admin, else the oldest member. Removing the chat from your own list (`deleteForMe`) hides it for you only.

**Status: Built.**
Gap: there is no "delete group for everyone".

## Sync of group data

Group changes (rename, members, roles, timer) arrive as system lines in the chat, so every device sees them. Big groups (over 256 members) send messages in batches of 500 instead of in one pass; read marks for them come from live events only.
