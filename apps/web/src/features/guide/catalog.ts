// Everything the in-app guide can say. One entry per topic; a topic is a short tour (the welcome
// tour) or a tip shown the first time someone meets a feature. To add one, see
// docs/features/guide.md: add an entry here, put `data-guide="<id>"` on the element a step points
// at, call useFeatureGuide('<topic id>') in the screen, and call markUsed('<topic id>') when the
// person really uses the feature.
//
// Words are for everyday people: short, friendly, no jargon.

export type GuidePlacement = 'top' | 'bottom' | 'auto';

export interface GuideStep {
  /** The `data-guide` id of the element to highlight. Missing, hidden or off-screen = a centred card. */
  target?: string;
  title: string;
  body: string;
  placement?: GuidePlacement;
  /**
   * Where the app should be for this step. 'list' = the chat list (no chat open), 'chat' = a chat
   * is open (the Saved messages chat is opened if none is). Leave out to keep things as they are.
   */
  scene?: 'list' | 'chat';
}

export type GuideTrigger = 'welcome' | 'first-open';

export interface GuideTopic {
  /** Lowercase letters, digits, dot, dash or underscore, 1-64 characters. Never change it later. */
  id: string;
  /** The group it is listed under in Settings > Guide and tips. */
  area: GuideArea;
  /** Shown in the guide list. */
  title: string;
  steps: readonly GuideStep[];
  /** 'welcome' = the first tour; 'first-open' = a tip queued by useFeatureGuide. Default: first-open. */
  trigger?: GuideTrigger;
  /** The page it belongs to, so "Show me" can open it first. Default: '/'. */
  route?: string;
  /** Topics this tour already showed: finishing it counts them as seen, so they come up no more as tips. */
  covers?: readonly string[];
}

export const GUIDE_AREAS = {
  start: 'Getting started',
  writing: 'Writing messages',
  messages: 'Reading and managing messages',
  find: 'Saved and search',
  groups: 'Groups',
  calls: 'Calls',
  assistant: 'Flick assistant',
  you: 'You and the app',
} as const;
export type GuideArea = keyof typeof GUIDE_AREAS;

export const WELCOME_ID = 'welcome';

/** Shortcuts for the words that repeat, so every tip says the same thing the same way. */
const HOLD_OR_RIGHT_CLICK = 'Press and hold it on a phone, or right-click it on a computer.';

export const TOPICS: readonly GuideTopic[] = [
  // ---------------------------------------------------------------- getting started
  {
    id: WELCOME_ID,
    area: 'start',
    title: 'Welcome tour',
    trigger: 'welcome',
    covers: [
      'chats.list',
      'chats.new',
      'composer.basics',
      'composer.attach',
      'message.menu',
      'search.chat',
      'calls.tab',
      'ai.flickchat',
      'install.app',
    ],
    steps: [
      {
        scene: 'list',
        target: 'chat-list',
        placement: 'auto',
        title: 'Your chats live here',
        body: 'Every conversation you have shows up in this list. Tap one to open it. New messages are shown in bold with a number.',
      },
      {
        scene: 'list',
        target: 'new-chat',
        placement: 'bottom',
        title: 'Start a new chat',
        body: 'Press this to find someone and say hello. The button next to it makes a group chat, and the People page in the top bar lists everyone on Flick.',
      },
      {
        scene: 'chat',
        target: 'composer',
        placement: 'top',
        title: 'Type your message here',
        body: 'Write a message and press the send button (or Enter on a computer). We have opened your Saved messages, a private chat with yourself that is perfect for trying things out.',
      },
      {
        scene: 'chat',
        target: 'composer.attach',
        placement: 'top',
        title: 'Add photos, files and more',
        body: 'Use this to send photos, videos, files, polls and GIFs. The camera button next to it (or in the same menu) takes a picture right away.',
      },
      {
        scene: 'chat',
        target: 'message',
        placement: 'auto',
        title: 'Do more with any message',
        body: `${HOLD_OR_RIGHT_CLICK} You can reply, react with an emoji, copy, forward, edit or delete it. Send yourself a message to try it.`,
      },
      {
        scene: 'list',
        target: 'search.messages',
        placement: 'bottom',
        title: 'Find anything again',
        body: 'Press the magnifier to search every message in all your chats. Tap a result to jump straight to it.',
      },
      {
        scene: 'list',
        target: 'nav.calls',
        placement: 'bottom',
        title: 'Voice and video calls',
        body: 'Call anyone from the phone and camera buttons at the top of a chat. This Calls page shows your past calls so you can ring people back.',
      },
      {
        scene: 'list',
        target: 'chat-list',
        placement: 'auto',
        title: 'Meet Flick, your assistant',
        body: 'Flick can answer questions, translate and summarise. Open your chat with Flick, or type @flick and your question in any chat.',
      },
      {
        scene: 'list',
        target: 'nav.settings',
        placement: 'bottom',
        title: 'Settings and your profile',
        body: 'Change how Flick looks, who can see you, notifications and more in Settings. Your photo and name are on the Profile page. You can come back to this guide in Settings at any time.',
      },
      {
        scene: 'list',
        target: 'install',
        placement: 'bottom',
        title: 'Put Flick on your home screen',
        body: 'Install Flick like an app so it opens in one tap and can tell you about new messages. If you do not see an Install button, your browser menu has "Add to Home Screen" or "Install".',
      },
    ],
  },
  {
    id: 'chats.list',
    area: 'start',
    title: 'Your chat list',
    steps: [
      {
        target: 'chat-list.search',
        placement: 'bottom',
        title: 'Find a chat fast',
        body: 'Type a name here to narrow the list down to the chats that match.',
      },
      {
        target: 'chat-list.tabs',
        placement: 'bottom',
        title: 'Filter your chats',
        body: 'Switch between all chats, unread ones, groups and favourites. Chats with new messages are in bold with a number.',
      },
    ],
  },
  {
    id: 'chats.new',
    area: 'start',
    title: 'Start a new chat',
    steps: [
      {
        target: 'new-chat',
        placement: 'bottom',
        title: 'Say hello to someone',
        body: 'Press this, search for a name or username, and tap the person to open a chat with them.',
      },
    ],
  },
  {
    id: 'people.directory',
    area: 'start',
    title: 'People and inviting friends',
    route: '/people',
    steps: [
      {
        target: 'people.list',
        placement: 'auto',
        title: 'Everyone on Flick, A to Z',
        body: 'People are listed in alphabetical order. Search for a name at the top, or on a phone tap a letter on the right edge to jump there. Tap a person to chat.',
      },
      {
        target: 'people.invite',
        placement: 'bottom',
        title: 'Friends not here yet?',
        body: 'Press Invite friends to send them a link. When they join, they will show up in this list.',
      },
    ],
  },
  {
    id: 'push.permission',
    area: 'start',
    title: 'Notifications when Flick is closed',
    steps: [
      {
        target: 'push.prompt',
        placement: 'bottom',
        title: 'Never miss a message',
        body: 'Turn on notifications and your device tells you about new messages even when Flick is closed. You can change this any time in Settings.',
      },
    ],
  },
  {
    id: 'install.app',
    area: 'start',
    title: 'Install Flick',
    steps: [
      {
        target: 'install',
        placement: 'bottom',
        title: 'Keep Flick on your device',
        body: 'On a phone it goes on your home screen, on a laptop it opens in its own window. It starts faster and can notify you about new messages.',
      },
    ],
  },
  {
    id: 'net.offline',
    area: 'start',
    title: 'When you are offline',
    steps: [
      {
        target: 'net.banner',
        placement: 'bottom',
        title: 'You seem to be offline',
        body: 'Do not worry. Messages you write now wait on your device and are sent as soon as you are back online. A clock next to a message means it is still waiting.',
      },
    ],
  },

  // ---------------------------------------------------------------- writing
  {
    id: 'composer.basics',
    area: 'writing',
    title: 'Writing a message',
    steps: [
      {
        target: 'composer',
        placement: 'top',
        title: 'Type here',
        body: 'Press Enter to send on a computer. Press Shift and Enter together for a new line. The box grows as you write, so long messages are fine.',
      },
      {
        target: 'composer.send',
        placement: 'top',
        title: 'Send',
        body: 'On a phone, press the send button. Press and hold it to choose a time to send later.',
      },
    ],
  },
  {
    id: 'composer.attach',
    area: 'writing',
    title: 'Photos, videos and files',
    steps: [
      {
        target: 'composer.attach',
        placement: 'top',
        title: 'Send more than words',
        body: 'Tap here to send a photo, video or file. On a phone these are in the plus menu. You can also drag a file onto the chat, or paste a picture.',
      },
    ],
  },
  {
    id: 'composer.camera',
    area: 'writing',
    title: 'Take a photo or video',
    steps: [
      {
        target: 'composer.camera',
        placement: 'top',
        title: 'Use your camera',
        body: 'Open the camera, take a picture or record a short video, check it and send it. Nothing is sent until you say so.',
      },
    ],
  },
  {
    id: 'composer.voice',
    area: 'writing',
    title: 'Voice notes',
    steps: [
      {
        target: 'composer.voice',
        placement: 'top',
        title: 'Say it instead of typing',
        body: 'Press the microphone to record a voice note. Press the stop button to finish, then send it or throw it away. The person can play it faster or slower.',
      },
    ],
  },
  {
    id: 'composer.format',
    area: 'writing',
    title: 'Formatting, tables and code',
    steps: [
      {
        target: 'composer.format',
        placement: 'top',
        title: 'Make your words stand out',
        body: 'This opens a small bar for bold, italic, lists, links and more. Select some words first, then press a button.',
      },
      {
        target: 'composer',
        placement: 'top',
        title: 'Or type it with symbols',
        body: 'You can also type it: **bold**, _italic_, "# " for a heading, "- " for a list, and three backticks around code. A table can be written with | bars between the columns.',
      },
      {
        target: 'composer',
        placement: 'top',
        title: 'Paste a table',
        body: 'Copy cells from a spreadsheet or a web page and paste them here. Flick turns them into a neat table for you.',
      },
    ],
  },
  {
    id: 'composer.schedule',
    area: 'writing',
    title: 'Schedule a message',
    steps: [
      {
        target: 'composer.schedule',
        placement: 'top',
        title: 'Send it later',
        body: 'Type your message, then press this clock to choose a day and time. Flick sends it for you, even if you are offline by then.',
      },
    ],
  },
  {
    id: 'composer.gif',
    area: 'writing',
    title: 'GIFs and stickers',
    steps: [
      {
        target: 'composer.gif',
        placement: 'top',
        title: 'Say it with a picture',
        body: 'Search for a funny GIF or a sticker and tap it to send. Try a word like "thanks" or "party".',
      },
    ],
  },
  {
    id: 'composer.poll',
    area: 'writing',
    title: 'Polls',
    steps: [
      {
        target: 'composer.poll',
        placement: 'top',
        title: 'Ask everyone to vote',
        body: 'Write a question and a few answers. People tap an answer to vote, and you all see the results grow.',
      },
    ],
  },
  {
    id: 'composer.emoji',
    area: 'writing',
    title: 'Emoji',
    steps: [
      {
        target: 'composer.emoji',
        placement: 'top',
        title: 'Add an emoji',
        body: 'Open the emoji picker and tap one to add it to your message. You can also type a colon and a word, like :smile, to find one.',
      },
    ],
  },
  {
    id: 'composer.viewonce',
    area: 'writing',
    title: 'View once photos and videos',
    steps: [
      {
        target: 'composer.viewonce',
        placement: 'top',
        title: 'A photo that disappears',
        body: 'Tick this before sending and the other person can open the photo or video only one time. After that it is gone.',
      },
    ],
  },

  // ---------------------------------------------------------------- reading and managing messages
  {
    id: 'message.menu',
    area: 'messages',
    title: 'Message actions',
    steps: [
      {
        target: 'message',
        placement: 'auto',
        title: 'Press and hold a message',
        body: `${HOLD_OR_RIGHT_CLICK} A menu opens with everything you can do. On a laptop you can also use the small arrow that appears next to a message.`,
      },
      {
        target: 'message',
        placement: 'auto',
        title: 'Reply and react',
        body: 'Pick Reply to answer that exact message, or tap an emoji at the top of the menu to react to it.',
      },
      {
        target: 'message',
        placement: 'auto',
        title: 'And much more',
        body: 'You can also copy, forward, pin, star, translate, edit your own message, delete it for you or for everyone, and see who has read it with Message info.',
      },
    ],
  },
  {
    id: 'message.ticks',
    area: 'messages',
    title: 'What the ticks mean',
    steps: [
      {
        target: 'message.status',
        placement: 'auto',
        title: 'Ticks under your messages',
        body: 'A clock means it is still sending. One tick means it reached Flick. Two ticks mean it reached their device. Two blue ticks mean they have read it.',
      },
    ],
  },
  {
    id: 'message.dates',
    area: 'messages',
    title: 'Dates in a chat',
    steps: [
      {
        target: 'chat.date',
        placement: 'bottom',
        title: 'Day markers',
        body: 'A small label shows the day each group of messages was sent, so you can tell what happened when. A line saying "unread messages" marks where you stopped reading.',
      },
    ],
  },
  {
    id: 'chat.jump',
    area: 'messages',
    title: 'Jump to the newest message',
    steps: [
      {
        target: 'chat.jump',
        placement: 'top',
        title: 'Back to the bottom',
        body: 'When you scroll up to read older messages, this arrow appears. A number on it counts the new messages that came in meanwhile. Tap it to jump back.',
      },
    ],
  },
  {
    id: 'chat.disappearing',
    area: 'messages',
    title: 'Disappearing messages',
    steps: [
      {
        target: 'chat.disappearing',
        placement: 'bottom',
        title: 'Messages that clean up after themselves',
        body: 'Choose a time, like one day, and new messages in this chat are deleted for everyone after that time. On a phone this is in the three-dot menu at the top.',
      },
    ],
  },
  {
    id: 'chat.pinned',
    area: 'messages',
    title: 'Pinned messages',
    steps: [
      {
        target: 'chat.pinned',
        placement: 'bottom',
        title: 'Important messages stay on top',
        body: 'A pinned message is shown here for everyone in the chat. Tap the bar to jump to it. If several are pinned, each tap shows the next one. Pin a message from its menu.',
      },
    ],
  },
  {
    id: 'chat.starred',
    area: 'messages',
    title: 'Starred messages',
    steps: [
      {
        target: 'starred.open',
        placement: 'bottom',
        title: 'Your own bookmarks',
        body: 'Star any message from its menu to keep it for later. Press this star to see everything you starred, from all your chats. Only you can see your stars.',
      },
    ],
  },
  {
    id: 'chat.search',
    area: 'messages',
    title: 'Search inside a chat',
    steps: [
      {
        target: 'chat.options',
        placement: 'bottom',
        title: 'Look inside this chat',
        body: 'Open the three-dot menu and choose Search in chat to find a message in this conversation only. The words you typed are highlighted in each result.',
      },
    ],
  },
  {
    id: 'chat.options',
    area: 'messages',
    title: 'Chat options',
    steps: [
      {
        target: 'chat.options',
        placement: 'bottom',
        title: 'Everything for this chat',
        body: 'The three-dot menu lets you pin, archive or favourite the chat, mute its notifications, lock it with a passcode, pick a wallpaper and search inside it. A copy of all your messages can be downloaded from Settings.',
      },
    ],
  },

  // ---------------------------------------------------------------- saved and search
  {
    id: 'saved.messages',
    area: 'find',
    title: 'Saved messages',
    steps: [
      {
        target: 'saved-row',
        placement: 'bottom',
        title: 'A chat just for you',
        body: 'Saved messages is a private place for notes, links, photos and reminders. Only you can see it.',
      },
    ],
  },
  {
    id: 'search.chat',
    area: 'find',
    title: 'Search your messages',
    steps: [
      {
        target: 'search.messages',
        placement: 'bottom',
        title: 'Find anything you were told',
        body: 'Press the magnifier to search every message in all your chats. Tap a result to jump to it.',
      },
    ],
  },
  {
    id: 'scheduled.list',
    area: 'find',
    title: 'Scheduled messages',
    steps: [
      {
        target: 'scheduled.open',
        placement: 'bottom',
        title: 'Messages waiting to be sent',
        body: 'See the messages you scheduled, change their time or cancel them here. To schedule one, press the clock next to the message box.',
      },
    ],
  },

  // ---------------------------------------------------------------- groups
  {
    id: 'group.create',
    area: 'groups',
    title: 'Create a group',
    steps: [
      {
        target: 'new-group',
        placement: 'bottom',
        title: 'Chat with many people',
        body: 'Give the group a name, add people from the list, and press Create group. You can add a photo and a description later.',
      },
    ],
  },
  {
    id: 'group.info',
    area: 'groups',
    title: 'Group info',
    steps: [
      {
        target: 'group.info',
        placement: 'bottom',
        title: 'Everything about this group',
        body: 'See who is in the group and add more people. Admins can make other members admins or remove them.',
      },
      {
        target: 'group.info',
        placement: 'bottom',
        title: 'Invite link and requests',
        body: 'Share an invite link so anyone with it can join. If the group asks for approval, admins see the join requests here and can accept or decline them.',
      },
      {
        target: 'group.info',
        placement: 'bottom',
        title: 'Photo and description',
        body: 'Admins can change the group name, photo and description here, so everyone knows what the group is for.',
      },
    ],
  },

  // ---------------------------------------------------------------- calls
  {
    id: 'calls.voice',
    area: 'calls',
    title: 'Voice calls',
    steps: [
      {
        target: 'call.voice',
        placement: 'bottom',
        title: 'Call them',
        body: 'Press the phone to start a voice call. Allow the microphone if your device asks. While you ring, you can hang up with the red button.',
      },
    ],
  },
  {
    id: 'calls.video',
    area: 'calls',
    title: 'Video calls and sharing your screen',
    steps: [
      {
        target: 'call.video',
        placement: 'bottom',
        title: 'See each other',
        body: 'Press the camera to start a video call. During a call you can turn your camera off, and on a laptop you can share your screen.',
      },
    ],
  },
  {
    id: 'calls.controls',
    area: 'calls',
    title: 'Controls during a call',
    steps: [
      {
        title: 'What the call buttons do',
        body: 'In a call you can mute your microphone, turn your camera off or on, share your screen on a laptop, switch the camera or speaker, and hang up with the red button. Your picture is the small tile in the corner.',
      },
    ],
  },
  {
    id: 'calls.group',
    area: 'calls',
    title: 'Group calls and call links',
    steps: [
      {
        target: 'call.group',
        placement: 'bottom',
        title: 'Call the whole group',
        body: 'Press this to start a call that everyone in the group can join. In Group info you can also make a call link and send it to anyone, even people who are not in the group.',
      },
    ],
  },
  {
    id: 'calls.tab',
    area: 'calls',
    title: 'Your call history',
    route: '/calls',
    steps: [
      {
        target: 'calls.list',
        placement: 'auto',
        title: 'Calls you made and missed',
        body: 'Every call is listed here. Missed calls are in red. Tap the phone or camera next to a name to call them back.',
      },
    ],
  },

  // ---------------------------------------------------------------- Flick assistant
  {
    id: 'ai.flickchat',
    area: 'assistant',
    title: 'Chat with Flick',
    steps: [
      {
        target: 'flick-chat',
        placement: 'auto',
        title: 'Ask anything',
        body: 'Flick is your assistant. Open this chat and ask a question, ask for a translation, or ask for help writing something. It answers in seconds.',
      },
    ],
  },
  {
    id: 'ai.ask',
    area: 'assistant',
    title: 'Ask Flick about a chat',
    steps: [
      {
        target: 'ai.ask',
        placement: 'bottom',
        title: 'Summarise or ask',
        body: 'Press the sparkles to get a short summary of this chat, or to ask Flick a question about what was said. Only you see the answer.',
      },
    ],
  },
  {
    id: 'ai.group',
    area: 'assistant',
    title: 'Flick in groups',
    steps: [
      {
        target: 'composer',
        placement: 'top',
        title: 'Bring Flick into the chat',
        body: "Type @flick and your question in a group and Flick answers for everybody. You can also reply to one of Flick's answers to keep the conversation going.",
      },
    ],
  },
  {
    id: 'ai.suggest',
    area: 'assistant',
    title: 'Suggested replies',
    steps: [
      {
        target: 'ai.suggest',
        placement: 'top',
        title: 'Not sure what to say?',
        body: 'Flick suggests a few short replies above the message box. Tap one to put it in the box, then change it or send it as it is.',
      },
    ],
  },

  // ---------------------------------------------------------------- you and the app
  {
    id: 'profile.page',
    area: 'you',
    title: 'Your profile',
    route: '/profile',
    steps: [
      {
        target: 'profile.photo',
        placement: 'auto',
        title: 'Your photo',
        body: 'Press the camera to choose a photo, take one, or remove it. Your sign-in account may also have a picture, and Flick keeps the two in step when you change it there.',
      },
      {
        target: 'profile.edit',
        placement: 'auto',
        title: 'Name, username and About',
        body: 'Change your display name, your @username (people use it to find you) and a short About line. Press Save when you are done.',
      },
    ],
  },
  {
    id: 'settings.page',
    area: 'you',
    title: 'Settings',
    route: '/settings',
    steps: [
      {
        target: 'settings.appearance',
        placement: 'auto',
        title: 'Make it look right',
        body: 'Under Appearance you can pick light or dark, make the text bigger or smaller, and choose a font.',
      },
      {
        target: 'settings.notifications',
        placement: 'auto',
        title: 'Notifications and quiet hours',
        body: 'Choose what makes a sound or a pop-up, and set quiet hours so Flick stays silent at night.',
      },
      {
        target: 'settings.privacy',
        placement: 'auto',
        title: 'Privacy and app lock',
        body: 'Decide who can see when you were last online, your photo and your About line, who can add you to groups, and who you have blocked. You can also lock the app with a passcode.',
      },
      {
        target: 'settings.account',
        placement: 'auto',
        title: 'Your account and devices',
        body: 'See the devices that are signed in and sign one out, download a copy of your data, or delete your account.',
      },
      {
        target: 'settings.storage',
        placement: 'auto',
        title: 'Storage',
        body: 'See how much space Flick uses on this device and clear it to free up room. Your messages stay safe on your account.',
      },
    ],
  },
];

const BY_ID = new Map(TOPICS.map((topic) => [topic.id, topic]));

export const getTopic = (id: string): GuideTopic | undefined => BY_ID.get(id);

/** Topics grouped by area, in the order the areas are listed. */
export function topicsByArea(): { area: GuideArea; label: string; topics: GuideTopic[] }[] {
  return (Object.keys(GUIDE_AREAS) as GuideArea[])
    .map((area) => ({
      area,
      label: GUIDE_AREAS[area],
      topics: TOPICS.filter((topic) => topic.area === area),
    }))
    .filter((group) => group.topics.length > 0);
}
