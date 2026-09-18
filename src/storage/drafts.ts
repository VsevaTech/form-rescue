/**
 * Draft persistence on top of `chrome.storage.local`.
 *
 * The storage area is injected so the whole module is testable in plain Node -
 * and so it stays obvious that no other transport exists. Expired drafts are
 * purged on every read, which is why the extension needs no alarms permission.
 */

import {
  ALLOWED_TTL_DAYS,
  DEFAULT_SETTINGS,
  DRAFT_VERSION,
  type Draft,
  type Settings,
} from '../shared/types';

export interface StorageArea {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export const DRAFT_PREFIX = 'draft:';
export const SETTINGS_KEY = 'settings';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds the storage key for a page.
 *
 * Only `origin + pathname` is used. Query parameters are dropped on purpose:
 * they routinely carry session ids, one-time tokens and tracking data that must
 * not end up in local storage.
 */
export function pageIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return `${parsed.origin}${parsed.pathname}`;
}

export function draftKey(pageId: string): string {
  return `${DRAFT_PREFIX}${pageId}`;
}

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<Draft>;
  return (
    typeof d.pageId === 'string' &&
    typeof d.savedAt === 'number' &&
    Array.isArray(d.fields) &&
    d.version === DRAFT_VERSION
  );
}

export function normalizeTtlDays(value: unknown): number {
  const n = Number(value);
  return (ALLOWED_TTL_DAYS as readonly number[]).includes(n) ? n : DEFAULT_SETTINGS.ttlDays;
}

export function isExpired(draft: Draft, ttlDays: number, now: number): boolean {
  return now - draft.savedAt > ttlDays * DAY_MS;
}

export function createDraftStore(area: StorageArea, clock: () => number = Date.now) {
  async function getSettings(): Promise<Settings> {
    const raw = await area.get([SETTINGS_KEY]);
    const stored = raw[SETTINGS_KEY] as Partial<Settings> | undefined;
    return { ttlDays: normalizeTtlDays(stored?.ttlDays) };
  }

  async function setSettings(settings: Settings): Promise<Settings> {
    const next: Settings = { ttlDays: normalizeTtlDays(settings.ttlDays) };
    await area.set({ [SETTINGS_KEY]: next });
    return next;
  }

  /** Deletes every expired draft and returns how many were removed. */
  async function purgeExpired(): Promise<number> {
    const { ttlDays } = await getSettings();
    const all = await area.get(null);
    const now = clock();
    const stale: string[] = [];

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(DRAFT_PREFIX)) continue;
      if (!isDraft(value) || isExpired(value, ttlDays, now)) stale.push(key);
    }

    if (stale.length > 0) await area.remove(stale);
    return stale.length;
  }

  async function saveDraft(draft: Draft): Promise<void> {
    await area.set({ [draftKey(draft.pageId)]: draft });
  }

  /** Returns the draft for a page, purging expired drafts along the way. */
  async function loadDraft(pageId: string): Promise<Draft | null> {
    await purgeExpired();
    const key = draftKey(pageId);
    const raw = await area.get([key]);
    const value = raw[key];
    if (!isDraft(value)) return null;
    return value;
  }

  async function deleteDraft(pageId: string): Promise<void> {
    await area.remove([draftKey(pageId)]);
  }

  async function listDrafts(): Promise<Draft[]> {
    await purgeExpired();
    const all = await area.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith(DRAFT_PREFIX))
      .map(([, value]) => value)
      .filter(isDraft);
  }

  return { getSettings, setSettings, purgeExpired, saveDraft, loadDraft, deleteDraft, listDrafts };
}

export type DraftStore = ReturnType<typeof createDraftStore>;

/** Adapter over the real extension storage. Only used inside the browser. */
export function chromeLocalArea(): StorageArea {
  return {
    get: (keys) => chrome.storage.local.get(keys as never) as Promise<Record<string, unknown>>,
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
}

let defaultStore: DraftStore | null = null;

/** Lazily-created store bound to `chrome.storage.local`. */
export function drafts(): DraftStore {
  if (!defaultStore) defaultStore = createDraftStore(chromeLocalArea());
  return defaultStore;
}
