/**
 * Autosave controller.
 *
 * Listens for `input` / `change` on the page, debounces, then writes a snapshot
 * of the safe fields. Nothing is written per keystroke, and nothing leaves the
 * browser.
 */

import { DRAFT_VERSION, type Draft } from '../shared/types';
import type { DraftStore } from '../storage/drafts';
import { pageIdFromUrl } from '../storage/drafts';
import { collectFields } from './fields';

export const DEFAULT_DEBOUNCE_MS = 700;

export interface AutosaveOptions {
  doc: Document;
  store: DraftStore;
  debounceMs?: number;
  clock?: () => number;
  /** Called after each successful write, used by the page indicator. */
  onSaved?: (draft: Draft) => void;
}

export interface AutosaveController {
  start(): void;
  stop(): void;
  /** Writes immediately, bypassing the debounce. Returns the draft or null. */
  flush(): Promise<Draft | null>;
  /** Number of writes performed, exposed for tests. */
  readonly writes: number;
}

export function createAutosave(options: AutosaveOptions): AutosaveController {
  const { doc, store, onSaved } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const clock = options.clock ?? Date.now;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let writes = 0;

  const pageId = pageIdFromUrl(doc.location?.href ?? '');

  async function write(): Promise<Draft | null> {
    if (!pageId) return null;

    const { fields, skippedSensitive } = collectFields(doc);

    if (fields.length === 0) {
      // An empty form should not leave a draft lying around.
      await store.deleteDraft(pageId);
      return null;
    }

    const url = new URL(doc.location.href);
    const draft: Draft = {
      version: DRAFT_VERSION,
      pageId,
      origin: url.origin,
      path: url.pathname,
      title: doc.title ?? '',
      savedAt: clock(),
      fields,
      skippedSensitive,
    };

    await store.saveDraft(draft);
    writes += 1;
    onSaved?.(draft);
    return draft;
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void write();
    }, debounceMs);
  }

  function onEvent(event: Event): void {
    const target = event.target as Element | null;
    if (!target || !('tagName' in target)) return;
    const tag = target.tagName?.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    schedule();
  }

  function onSubmit(): void {
    // A submit usually means the data reached its destination. The draft is
    // dropped only on this explicit signal; if the submit turns out to have
    // failed, the user simply refills - which is still better than us guessing
    // about network success and deleting a good draft too early.
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pageId) void store.deleteDraft(pageId);
  }

  return {
    start() {
      if (started) return;
      started = true;
      doc.addEventListener('input', onEvent, true);
      doc.addEventListener('change', onEvent, true);
      doc.addEventListener('submit', onSubmit, true);
    },
    stop() {
      if (!started) return;
      started = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      doc.removeEventListener('input', onEvent, true);
      doc.removeEventListener('change', onEvent, true);
      doc.removeEventListener('submit', onSubmit, true);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return write();
    },
    get writes() {
      return writes;
    },
  };
}
