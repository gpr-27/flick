// The catalog is data, so these tests guard its shape: no duplicate ids, real copy in every step,
// and every promise it makes (a target on screen, a screen that asks for the tip) is kept somewhere
// in the source. They read the source files, so adding a topic without wiring it fails here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDE_MAX_TOPICS, GuideTopicId } from '@chat/contracts';
import { describe, expect, it } from 'vitest';
import { GUIDE_AREAS, TOPICS, WELCOME_ID, getTopic, topicsByArea } from './catalog';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
  isCatalog: path.endsWith(join('guide', 'catalog.ts')),
}));
const outsideCatalog = files.filter((f) => !f.isCatalog);

/** Every `data-guide` / `guideId` value in the source (a value may hold several ids). */
function guideTargetsInSource(): Set<string> {
  const found = new Set<string>();
  for (const { text } of outsideCatalog) {
    for (const match of text.matchAll(/(?:data-guide|guideId)=(?:"([^"]+)"|\{([^}]*)\})/g)) {
      const plain = match[1];
      if (plain) plain.split(/\s+/).forEach((id) => found.add(id));
      for (const quoted of (match[2] ?? '').matchAll(/'([^']+)'/g)) {
        const id = quoted[1];
        if (id) found.add(id);
      }
    }
  }
  // Settings puts `settings.<section id>` on each of its sections.
  const settings = readFileSync(join(SRC, 'features', 'settings', 'SettingsPage.tsx'), 'utf8');
  for (const match of settings.matchAll(/\bid: '([a-z]+)',\s*title:/g)) {
    if (match[1]) found.add(`settings.${match[1]}`);
  }
  return found;
}

describe('guide catalog', () => {
  it('has unique, valid topic ids and a limit that fits the server', () => {
    const ids = TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(GuideTopicId.safeParse(id).success, id).toBe(true);
    // Seen and used lists are capped on the server; every topic must fit in one list.
    expect(ids.length).toBeLessThan(GUIDE_MAX_TOPICS);
  });

  it('gives every topic and step real, friendly copy', () => {
    for (const topic of TOPICS) {
      expect(topic.title.trim(), topic.id).not.toBe('');
      expect(topic.steps.length, topic.id).toBeGreaterThan(0);
      expect(topic.area in GUIDE_AREAS, topic.id).toBe(true);
      for (const step of topic.steps) {
        expect(step.title.trim().length, `${topic.id} title`).toBeGreaterThan(2);
        expect(step.body.trim().length, `${topic.id} body`).toBeGreaterThan(20);
        expect(step.title.length, `${topic.id} title is short`).toBeLessThan(60);
        expect(step.body.length, `${topic.id} body is short`).toBeLessThan(330);
      }
    }
  });

  it('has exactly one welcome tour of about ten steps', () => {
    const tours = TOPICS.filter((t) => t.trigger === 'welcome');
    expect(tours.map((t) => t.id)).toEqual([WELCOME_ID]);
    expect(getTopic(WELCOME_ID)?.steps.length).toBeGreaterThanOrEqual(8);
    expect(getTopic(WELCOME_ID)?.steps.length).toBeLessThanOrEqual(12);
  });

  it('only says it covers topics that exist', () => {
    for (const topic of TOPICS) {
      for (const id of topic.covers ?? [])
        expect(getTopic(id), `${topic.id} covers ${id}`).toBeDefined();
    }
  });

  it('lists every topic under exactly one area', () => {
    const listed = topicsByArea().flatMap((g) => g.topics.map((t) => t.id));
    expect(listed.sort()).toEqual(TOPICS.map((t) => t.id).sort());
  });

  it('every step with a target has that data-guide attribute somewhere in src', () => {
    const present = guideTargetsInSource();
    const missing: string[] = [];
    for (const topic of TOPICS) {
      for (const step of topic.steps) {
        if (step.target && !present.has(step.target)) missing.push(`${topic.id} -> ${step.target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every tip is asked for by a screen, and every id used in code is in the catalog', () => {
    const known = new Set(TOPICS.map((t) => t.id));
    const quoted = new Set<string>();
    for (const { text } of outsideCatalog) {
      for (const match of text.matchAll(/'([a-z0-9][a-z0-9._-]*)'/g)) {
        if (match[1]) quoted.add(match[1]);
      }
    }
    const unwired = TOPICS.filter((t) => t.trigger !== 'welcome' && !quoted.has(t.id)).map(
      (t) => t.id,
    );
    expect(unwired).toEqual([]);

    // Ids handed to the guide calls must exist (a typo would silently do nothing).
    const unknown: string[] = [];
    for (const { text } of outsideCatalog) {
      for (const call of text.matchAll(
        /(?:useFeatureGuide|markUsed|useMarkUsedWhen|requestTip)\(\s*'([^']+)'/g,
      )) {
        if (call[1] && !known.has(call[1])) unknown.push(call[1]);
      }
      for (const list of text.matchAll(/useFeatureGuides\(\s*\[([^\]]*)\]/g)) {
        for (const id of (list[1] ?? '').matchAll(/'([^']+)'/g)) {
          if (id[1] && !known.has(id[1])) unknown.push(id[1]);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('covers the features the product has (a topic for each)', () => {
    const must = [
      'welcome',
      'chats.list',
      'chats.new',
      'people.directory',
      'composer.basics',
      'composer.attach',
      'composer.camera',
      'composer.voice',
      'composer.format',
      'composer.schedule',
      'composer.gif',
      'composer.poll',
      'composer.emoji',
      'composer.viewonce',
      'message.menu',
      'chat.disappearing',
      'chat.pinned',
      'chat.starred',
      'chat.search',
      'chat.options',
      'saved.messages',
      'group.create',
      'group.info',
      'calls.voice',
      'calls.video',
      'calls.group',
      'calls.controls',
      'calls.tab',
      'ai.flickchat',
      'ai.ask',
      'ai.group',
      'ai.suggest',
      'profile.page',
      'settings.page',
      'install.app',
      'push.permission',
      'message.ticks',
      'message.dates',
      'chat.jump',
      'net.offline',
    ];
    for (const id of must) expect(getTopic(id), id).toBeDefined();
  });
});
