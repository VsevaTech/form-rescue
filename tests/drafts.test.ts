import { describe, expect, it } from 'vitest';
import { DRAFT_VERSION, type Draft } from '../src/shared/types';
import {
  DRAFT_PREFIX,
  createDraftStore,
  draftKey,
  isExpired,
  normalizeTtlDays,
  pageIdFromUrl,
} from '../src/storage/drafts';
import { memoryArea } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

function draft(pageId: string, savedAt: number, fieldCount = 1): Draft {
  return {
    version: DRAFT_VERSION,
    pageId,
    origin: new URL(pageId).origin,
    path: new URL(pageId).pathname,
    title: 'Test',
    savedAt,
    fields: Array.from({ length: fieldCount }, (_, i) => ({
      by: 'id' as const,
      key: `f${i}`,
      formIndex: 0,
      index: 0,
      kind: 'text' as const,
      value: `v${i}`,
    })),
    skippedSensitive: 0,
  };
}

describe('pageIdFromUrl', () => {
  it('uses origin + pathname only', () => {
    expect(pageIdFromUrl('https://a.example.com/apply/step-2?session=abc#top')).toBe(
      'https://a.example.com/apply/step-2',
    );
  });

  it('drops query parameters so session tokens never reach storage', () => {
    const withToken = pageIdFromUrl('https://a.example.com/apply?access_token=secret-value');
    expect(withToken).toBe('https://a.example.com/apply');
    expect(withToken).not.toContain('secret-value');
  });

  it('rejects non-http(s) and malformed URLs', () => {
    expect(pageIdFromUrl('chrome://extensions')).toBeNull();
    expect(pageIdFromUrl('file:///tmp/form.html')).toBeNull();
    expect(pageIdFromUrl('not a url')).toBeNull();
  });
});

describe('ttl helpers', () => {
  it('accepts only the offered values', () => {
    expect(normalizeTtlDays(1)).toBe(1);
    expect(normalizeTtlDays(7)).toBe(7);
    expect(normalizeTtlDays(30)).toBe(30);
    expect(normalizeTtlDays(99)).toBe(7);
    expect(normalizeTtlDays('nonsense')).toBe(7);
    expect(normalizeTtlDays(undefined)).toBe(7);
  });

  it('expires strictly after the ttl window', () => {
    const now = 10 * DAY;
    expect(isExpired(draft('https://x.test/a', now - 6 * DAY), 7, now)).toBe(false);
    expect(isExpired(draft('https://x.test/a', now - 8 * DAY), 7, now)).toBe(true);
  });
});

describe('draft store', () => {
  it('saves and loads a draft', async () => {
    const mem = memoryArea();
    const store = createDraftStore(mem.area);
    await store.saveDraft(draft('https://x.test/a', Date.now(), 3));

    const loaded = await store.loadDraft('https://x.test/a');
    expect(loaded?.fields).toHaveLength(3);
    expect(Object.keys(mem.snapshot())).toContain(draftKey('https://x.test/a'));
  });

  it('isolates drafts by origin and path', async () => {
    const mem = memoryArea();
    const store = createDraftStore(mem.area);
    await store.saveDraft(draft('https://a.test/apply', Date.now(), 1));
    await store.saveDraft(draft('https://b.test/apply', Date.now(), 2));
    await store.saveDraft(draft('https://a.test/other', Date.now(), 3));

    expect((await store.loadDraft('https://a.test/apply'))?.fields).toHaveLength(1);
    expect((await store.loadDraft('https://b.test/apply'))?.fields).toHaveLength(2);
    expect((await store.loadDraft('https://a.test/other'))?.fields).toHaveLength(3);
    expect(await store.loadDraft('https://c.test/apply')).toBeNull();
  });

  it('deletes a single draft and leaves the others alone', async () => {
    const mem = memoryArea();
    const store = createDraftStore(mem.area);
    await store.saveDraft(draft('https://a.test/one', Date.now()));
    await store.saveDraft(draft('https://a.test/two', Date.now()));

    await store.deleteDraft('https://a.test/one');
    expect(await store.loadDraft('https://a.test/one')).toBeNull();
    expect(await store.loadDraft('https://a.test/two')).not.toBeNull();
  });

  it('removes expired drafts when storage is read', async () => {
    let now = 100 * DAY;
    const mem = memoryArea();
    const store = createDraftStore(mem.area, () => now);

    await store.saveDraft(draft('https://a.test/fresh', now));
    await store.saveDraft(draft('https://a.test/stale', now - 9 * DAY));

    expect(await store.loadDraft('https://a.test/stale')).toBeNull();
    expect(await store.loadDraft('https://a.test/fresh')).not.toBeNull();
    expect(Object.keys(mem.snapshot()).filter((k) => k.startsWith(DRAFT_PREFIX))).toEqual([
      draftKey('https://a.test/fresh'),
    ]);

    now += 20 * DAY;
    expect(await store.loadDraft('https://a.test/fresh')).toBeNull();
  });

  it('honours a changed ttl setting', async () => {
    const now = 100 * DAY;
    const mem = memoryArea();
    const store = createDraftStore(mem.area, () => now);
    await store.saveDraft(draft('https://a.test/x', now - 3 * DAY));

    expect(await store.loadDraft('https://a.test/x')).not.toBeNull();
    await store.setSettings({ ttlDays: 1 });
    expect(await store.loadDraft('https://a.test/x')).toBeNull();
  });

  it('drops drafts written by an incompatible schema version', async () => {
    const mem = memoryArea({
      [draftKey('https://a.test/old')]: { ...draft('https://a.test/old', Date.now()), version: 0 },
    });
    const store = createDraftStore(mem.area);
    expect(await store.loadDraft('https://a.test/old')).toBeNull();
  });

  it('defaults to a 7 day ttl and persists a new choice', async () => {
    const mem = memoryArea();
    const store = createDraftStore(mem.area);
    expect(await store.getSettings()).toEqual({ ttlDays: 7 });
    await store.setSettings({ ttlDays: 30 });
    expect(await store.getSettings()).toEqual({ ttlDays: 30 });
  });

  it('lists live drafts only', async () => {
    const now = 100 * DAY;
    const mem = memoryArea();
    const store = createDraftStore(mem.area, () => now);
    await store.saveDraft(draft('https://a.test/1', now));
    await store.saveDraft(draft('https://a.test/2', now - 30 * DAY));
    const list = await store.listDrafts();
    expect(list.map((d) => d.pageId)).toEqual(['https://a.test/1']);
  });
});
