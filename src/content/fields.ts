/**
 * Field discovery, identification and value access.
 *
 * Identification uses a deliberately short fallback chain - `id`, then `name`,
 * then a *short* CSS selector. Long, structural selectors are not built: they
 * break on the smallest markup change and risk restoring a value into the wrong
 * control, which is worse than not restoring it at all.
 */

import type { FieldKind, FieldLocator, FieldValue, SavedField } from '../shared/types';
import { inspectSensitivity } from './sensitive';

export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const CONTROL_SELECTOR = 'input, textarea, select';

/** Maximum number of ancestor steps allowed in a fallback CSS selector. */
const MAX_SELECTOR_DEPTH = 4;

export function isFormControl(el: Element): el is FormControl {
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function kindOf(el: FormControl): FieldKind {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return (el as HTMLSelectElement).multiple ? 'select-multiple' : 'select';
  const type = ((el as HTMLInputElement).getAttribute('type') ?? 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  return 'text';
}

function formIndexOf(el: FormControl, doc: Document): number {
  const form = el.form;
  if (!form) return -1;
  return Array.prototype.indexOf.call(doc.forms, form);
}

function scopeFor(formIndex: number, doc: Document): ParentNode {
  if (formIndex < 0) return doc;
  const form = doc.forms[formIndex];
  return form ?? doc;
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function queryAllSafe(scope: ParentNode, selector: string): Element[] {
  try {
    return Array.from(scope.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Builds a short selector for controls with neither id nor name.
 *
 * Anchors on the closest ancestor carrying a unique id when there is one,
 * otherwise walks at most `MAX_SELECTOR_DEPTH` levels. Returns `null` when no
 * short, unambiguous selector exists - the field is then simply not saved.
 */
export function buildShortSelector(el: Element, doc: Document): string | null {
  const parts: string[] = [];
  let current: Element | null = el;
  let anchored = false;

  for (let depth = 0; depth <= MAX_SELECTOR_DEPTH; depth += 1) {
    if (!current) break;

    const id = current.getAttribute('id');
    if (id && doc.querySelectorAll(`[id="${escapeAttr(id)}"]`).length === 1) {
      parts.unshift(`[id="${escapeAttr(id)}"]`);
      anchored = true;
      break;
    }

    const parent: Element | null = current.parentElement;
    const tag = current.tagName.toLowerCase();

    if (!parent) {
      // Reached the document element: the path is complete on its own.
      parts.unshift(tag);
      anchored = true;
      break;
    }

    const siblings = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === tag);
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = parent;
  }

  // Not anchored to an id or to the root within the depth budget: refuse rather
  // than emit a long, floating selector that could match the wrong control.
  if (!anchored || parts.length === 0) return null;

  const selector = parts.join(' > ');
  return doc.querySelectorAll(selector).length === 1 ? selector : null;
}

/** Computes the locator used to find this control again after a reload. */
export function locatorFor(el: FormControl, doc: Document): FieldLocator | null {
  const formIndex = formIndexOf(el, doc);
  const kind = kindOf(el);

  const id = el.getAttribute('id');
  if (id && doc.querySelectorAll(`[id="${escapeAttr(id)}"]`).length === 1) {
    return { by: 'id', key: id, formIndex, index: 0 };
  }

  const name = el.getAttribute('name');
  if (name) {
    const scope = scopeFor(formIndex, doc);
    const matches = queryAllSafe(scope, `[name="${escapeAttr(name)}"]`).filter(isFormControl);
    if (kind === 'radio') {
      // A radio group is addressed by name + value, not by position.
      return { by: 'name', key: name, formIndex, index: 0 };
    }
    const index = matches.indexOf(el);
    if (index >= 0) return { by: 'name', key: name, formIndex, index };
  }

  // Radios without a name cannot be grouped reliably - skip them.
  if (kind === 'radio') return null;

  const selector = buildShortSelector(el, doc);
  if (selector) return { by: 'selector', key: selector, formIndex, index: 0 };

  return null;
}

/** Resolves a stored locator back to a live element, or `null` when unsure. */
export function resolveLocator(locator: FieldLocator, doc: Document): FormControl | null {
  if (locator.by === 'id') {
    const matches = queryAllSafe(doc, `[id="${escapeAttr(locator.key)}"]`);
    if (matches.length !== 1) return null;
    const el = matches[0];
    return el && isFormControl(el) ? el : null;
  }

  if (locator.by === 'name') {
    const scope = scopeFor(locator.formIndex, doc);
    const matches = queryAllSafe(scope, `[name="${escapeAttr(locator.key)}"]`).filter(isFormControl);
    const el = matches[locator.index];
    return el ?? null;
  }

  const matches = queryAllSafe(doc, locator.key);
  if (matches.length !== 1) return null;
  const el = matches[0];
  return el && isFormControl(el) ? el : null;
}

/** Reads the current value of a control in a shape that survives JSON. */
export function readValue(el: FormControl, kind: FieldKind): FieldValue | null {
  switch (kind) {
    case 'checkbox':
      return (el as HTMLInputElement).checked;
    case 'radio':
      return (el as HTMLInputElement).checked ? (el as HTMLInputElement).value : null;
    case 'select-multiple':
      return Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.value);
    default:
      return (el as HTMLInputElement | HTMLTextAreaElement).value;
  }
}

/** True when a value carries no information worth storing. */
export function isEmptyValue(kind: FieldKind, value: FieldValue | null): boolean {
  if (value === null || value === undefined) return true;
  if (kind === 'checkbox') return value === false;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'string' && value.length === 0;
}

export interface CollectResult {
  fields: SavedField[];
  /** Controls skipped because they looked sensitive. */
  skippedSensitive: number;
  /** Controls skipped because no reliable locator could be built. */
  skippedUnlocatable: number;
}

/**
 * Walks the document and returns everything that is safe to persist.
 *
 * Sensitive controls never reach the returned array - they are counted and
 * dropped here, before any storage code can see them.
 */
export function collectFields(doc: Document): CollectResult {
  const fields: SavedField[] = [];
  const seenRadioGroups = new Set<string>();
  let skippedSensitive = 0;
  let skippedUnlocatable = 0;

  for (const el of Array.from(doc.querySelectorAll(CONTROL_SELECTOR))) {
    if (!isFormControl(el)) continue;

    const verdict = inspectSensitivity(el);
    if (verdict.sensitive) {
      if (verdict.reason !== 'unsupported-type') skippedSensitive += 1;
      continue;
    }

    if (el.disabled) continue;

    const kind = kindOf(el);
    const value = readValue(el, kind);
    if (isEmptyValue(kind, value)) continue;

    const locator = locatorFor(el, doc);
    if (!locator) {
      skippedUnlocatable += 1;
      continue;
    }

    if (kind === 'radio') {
      const groupKey = `${locator.formIndex}::${locator.key}`;
      if (seenRadioGroups.has(groupKey)) continue;
      seenRadioGroups.add(groupKey);
    }

    fields.push({ ...locator, kind, value: value as FieldValue });
  }

  return { fields, skippedSensitive, skippedUnlocatable };
}
