/**
 * Shared data shapes for Form Rescue.
 *
 * Everything here is stored locally in `chrome.storage.local`. Nothing in this
 * file is ever serialised to a network request - the extension has no backend.
 */

/** Current on-disk draft schema version. Bump on breaking changes. */
export const DRAFT_VERSION = 1;

/** Kinds of controls Form Rescue knows how to save and restore. */
export type FieldKind = 'text' | 'textarea' | 'select' | 'select-multiple' | 'checkbox' | 'radio';

/** How a field is located again after a reload. Tried in this order. */
export type LocatorKind = 'id' | 'name' | 'selector';

export interface FieldLocator {
  by: LocatorKind;
  /** Element id, control name, or a short CSS selector. */
  key: string;
  /**
   * Index of the owning `<form>` in `document.forms`, or -1 when the control is
   * not inside a form. Used to scope `name` lookups.
   */
  formIndex: number;
  /** Position among controls matching the same key inside the same scope. */
  index: number;
}

export type FieldValue = string | boolean | string[];

export interface SavedField extends FieldLocator {
  kind: FieldKind;
  value: FieldValue;
}

export interface Draft {
  version: number;
  /** `origin + pathname`. Query string and hash are deliberately excluded. */
  pageId: string;
  origin: string;
  path: string;
  /** Page title at save time, purely informational for the popup. */
  title: string;
  /** Epoch milliseconds. */
  savedAt: number;
  fields: SavedField[];
  /** How many controls were skipped because they looked sensitive. */
  skippedSensitive: number;
}

export interface Settings {
  /** Draft time-to-live, in days. */
  ttlDays: number;
}

export const DEFAULT_SETTINGS: Settings = { ttlDays: 7 };
export const ALLOWED_TTL_DAYS = [1, 7, 30] as const;

export interface RestoreResult {
  restored: number;
  skipped: number;
}

/** Messages exchanged between the popup and the content script. */
export type RuntimeMessage =
  | { type: 'FORM_RESCUE_PING' }
  | { type: 'FORM_RESCUE_STATE' }
  | { type: 'FORM_RESCUE_RESTORE' }
  | { type: 'FORM_RESCUE_SAVE_NOW' };

export type RuntimeResponse =
  | { ok: true; type: 'PONG' }
  | { ok: true; type: 'STATE'; pageId: string | null }
  | { ok: true; type: 'RESTORED'; result: RestoreResult }
  | { ok: true; type: 'SAVED' }
  | { ok: false; error: string };
