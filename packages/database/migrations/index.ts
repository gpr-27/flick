import type { Migration } from 'kysely/migration';

import * as m0001 from './0001_identity.js';
import * as m0002 from './0002_messaging.js';
import * as m0003 from './0003_delivery.js';
import * as m0004 from './0004_social.js';
import * as m0005 from './0005_message_changes.js';
import * as m0006 from './0006_clerk.js';
import * as m0007 from './0007_trim.js';
import * as m0008 from './0008_calls.js';
import * as m0009 from './0009_privacy.js';
import * as m0010 from './0010_perf.js';
import * as m0011 from './0011_account.js';
import * as m0012 from './0012_saved_and_scheduled.js';
import * as m0013 from './0013_guide.js';
import * as m0015 from './0015_chat_list.js';
import * as m0016 from './0016_reminders.js';
import * as m0017 from './0017_notifications.js';
import * as m0018 from './0018_long_text.js';
import * as m0019 from './0019_message_notes_edits.js';
import * as m0020 from './0020_conversation_drafts.js';
import * as m0022 from './0022_chat_lists.js';
import * as m0023 from './0023_ai_privacy.js';
import * as m0024 from './0024_flick_assistant.js';
import * as m0025 from './0025_productivity.js';
import * as m0027 from './0027_group_tools.js';
import * as m0028 from './0028_writing.js';
import * as m0029 from './0029_transcripts.js';
import * as m0031 from './0031_platform.js';
import * as m0032 from './0032_events.js';
import * as m0033 from './0033_topic_resume.js';
import * as m0034 from './0034_transcript_author.js';

// Listed explicitly (instead of scanning the folder) so the same code works under tsx, vitest
// and compiled dist/. Kysely applies them in name order.
export const migrations: Record<string, Migration> = {
  '0001_identity': m0001,
  '0002_messaging': m0002,
  '0003_delivery': m0003,
  '0004_social': m0004,
  '0005_message_changes': m0005,
  '0006_clerk': m0006,
  '0007_trim': m0007,
  '0008_calls': m0008,
  '0009_privacy': m0009,
  '0010_perf': m0010,
  '0011_account': m0011,
  '0012_saved_and_scheduled': m0012,
  '0013_guide': m0013,
  '0015_chat_list': m0015,
  '0016_reminders': m0016,
  '0017_notifications': m0017,
  '0018_long_text': m0018,
  '0019_message_notes_edits': m0019,
  '0020_conversation_drafts': m0020,
  '0022_chat_lists': m0022,
  '0023_ai_privacy': m0023,
  '0024_flick_assistant': m0024,
  '0025_productivity': m0025,
  '0027_group_tools': m0027,
  '0028_writing': m0028,
  '0029_transcripts': m0029,
  '0031_platform': m0031,
  '0032_events': m0032,
  '0033_topic_resume': m0033,
  '0034_transcript_author': m0034,
};
