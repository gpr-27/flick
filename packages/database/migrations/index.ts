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
import * as m0016 from './0016_reminders.js';

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
  '0016_reminders': m0016,
};
