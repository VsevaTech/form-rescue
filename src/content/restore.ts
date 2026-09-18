/**
 * Restore controller.
 *
 * Restore never happens automatically - it runs only when the user presses
 * "Restore" in the popup. Any field that cannot be matched with confidence is
 * skipped rather than guessed at.
 */

import type { Draft, RestoreResult, SavedField } from '../shared/types';
import { isFormControl, kindOf, resolveLocator, type FormControl } from './fields';
import { inspectSensitivity } from './sensitive';

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function applyValue(el: FormControl, field: SavedField): boolean {
  switch (field.kind) {
    case 'checkbox': {
      (el as HTMLInputElement).checked = field.value === true;
      return true;
    }
    case 'radio': {
      const input = el as HTMLInputElement;
      if (input.type === 'radio' && typeof field.value === 'string') {
        // The locator may point at the group; select the member by value.
        const scope = input.form ?? el.ownerDocument;
        const groupName = input.name;
        const group = groupName
          ? Array.from(
              scope.querySelectorAll<HTMLInputElement>(
                `input[type="radio"][name="${groupName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
              ),
            )
          : [];
        if (group.length > 0) {
          const match = group.find((r) => r.value === field.value);
          if (!match) return false;
          match.checked = true;
          fire(match, 'input');
          fire(match, 'change');
          return true;
        }
        if (input.value !== field.value) return false;
        input.checked = true;
        return true;
      }
      return false;
    }
    case 'select-multiple': {
      const select = el as HTMLSelectElement;
      if (!Array.isArray(field.value)) return false;
      const wanted = new Set(field.value);
      let any = false;
      for (const option of Array.from(select.options)) {
        option.selected = wanted.has(option.value);
        if (option.selected) any = true;
      }
      return any;
    }
    case 'select': {
      const select = el as HTMLSelectElement;
      if (typeof field.value !== 'string') return false;
      const hasOption = Array.from(select.options).some((o) => o.value === field.value);
      if (!hasOption) return false;
      select.value = field.value;
      return true;
    }
    default: {
      if (typeof field.value !== 'string') return false;
      (el as HTMLInputElement | HTMLTextAreaElement).value = field.value;
      return true;
    }
  }
}

/**
 * Applies a draft to the current document.
 *
 * A field is restored only when the located element still exists, is still the
 * same kind of control, and is still considered safe. Otherwise it is skipped.
 */
export function restoreDraft(draft: Draft, doc: Document): RestoreResult {
  let restored = 0;
  let skipped = 0;

  for (const field of draft.fields) {
    const el = resolveLocator(field, doc);

    if (!el || !isFormControl(el)) {
      skipped += 1;
      continue;
    }

    // The DOM may have changed since the draft was written. Refuse to write a
    // value into a control of a different kind.
    if (kindOf(el) !== field.kind) {
      skipped += 1;
      continue;
    }

    // Re-check sensitivity at restore time: the page may have swapped a plain
    // text input for a card-number field under the same id.
    if (inspectSensitivity(el).sensitive) {
      skipped += 1;
      continue;
    }

    let applied = false;
    try {
      applied = applyValue(el, field);
    } catch {
      applied = false;
    }

    if (!applied) {
      skipped += 1;
      continue;
    }

    if (field.kind !== 'radio') {
      fire(el, 'input');
      fire(el, 'change');
    }
    restored += 1;
  }

  return { restored, skipped };
}
