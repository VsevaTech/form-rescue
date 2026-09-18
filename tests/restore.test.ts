import { describe, expect, it } from 'vitest';
import { createAutosave } from '../src/content/autosave';
import { restoreDraft } from '../src/content/restore';
import { createDraftStore } from '../src/storage/drafts';
import type { Draft } from '../src/shared/types';
import {
  LONG_FORM_HTML,
  SAFE_VALUES,
  SENSITIVE_VALUES,
  fillLongForm,
  memoryArea,
  mountPage,
} from './helpers';

const PAGE = 'https://forms.example.com/apply';

/** Fills the form, saves a draft, then wipes the page as a crash would. */
async function fillSaveAndCrash(): Promise<{ draft: Draft; doc: Document }> {
  let doc = mountPage(LONG_FORM_HTML, PAGE);
  fillLongForm(doc);

  const mem = memoryArea();
  const store = createDraftStore(mem.area);
  await createAutosave({ doc, store }).flush();
  const draft = (await store.loadDraft(PAGE))!;

  // The "crash": fresh markup, every value gone.
  doc = mountPage(LONG_FORM_HTML, PAGE);
  return { draft, doc };
}

describe('restoreDraft', () => {
  it('restores the safe fields after a crash and leaves sensitive ones empty', async () => {
    const { draft, doc } = await fillSaveAndCrash();

    const result = restoreDraft(draft, doc);
    expect(result).toEqual({ restored: 14, skipped: 0 });

    for (const [id, value] of Object.entries(SAFE_VALUES)) {
      expect((doc.getElementById(id) as HTMLInputElement).value).toBe(value);
    }
    expect((doc.getElementById('country') as HTMLSelectElement).value).toBe('ae');
    expect((doc.getElementById('newsletter') as HTMLInputElement).checked).toBe(true);
    expect(
      (doc.querySelector('input[name="preferred_contact"][value="phone"]') as HTMLInputElement)
        .checked,
    ).toBe(true);

    for (const id of Object.keys(SENSITIVE_VALUES)) {
      expect((doc.getElementById(id) as HTMLInputElement).value).toBe('');
    }
  });

  it('fires input and change events so page scripts notice', async () => {
    const { draft, doc } = await fillSaveAndCrash();
    const seen: string[] = [];
    doc.getElementById('email')!.addEventListener('input', () => seen.push('input'));
    doc.getElementById('email')!.addEventListener('change', () => seen.push('change'));

    restoreDraft(draft, doc);
    expect(seen).toEqual(['input', 'change']);
  });

  it('skips fields that no longer exist instead of guessing', async () => {
    const { draft, doc } = await fillSaveAndCrash();
    doc.getElementById('city')!.remove();
    doc.getElementById('comment')!.remove();

    const result = restoreDraft(draft, doc);
    expect(result).toEqual({ restored: 12, skipped: 2 });
  });

  it('refuses to write into a control of a different kind', async () => {
    const { draft, doc } = await fillSaveAndCrash();
    // The page was redeployed: the "city" text input became a select.
    doc.getElementById('city')!.outerHTML = '<select id="city" name="city"></select>';

    const result = restoreDraft(draft, doc);
    expect(result.skipped).toBe(1);
    expect((doc.getElementById('city') as HTMLSelectElement).value).toBe('');
  });

  it('refuses to restore into a control that has become sensitive', async () => {
    const { draft, doc } = await fillSaveAndCrash();
    doc.getElementById('city')!.setAttribute('autocomplete', 'cc-number');

    const result = restoreDraft(draft, doc);
    expect(result.skipped).toBe(1);
    expect((doc.getElementById('city') as HTMLInputElement).value).toBe('');
  });

  it('skips a select whose option is gone', async () => {
    const { draft, doc } = await fillSaveAndCrash();
    doc.querySelector('#country option[value="ae"]')!.remove();

    const result = restoreDraft(draft, doc);
    expect(result.skipped).toBe(1);
    expect((doc.getElementById('country') as HTMLSelectElement).value).toBe('');
  });

  it('skips a radio whose option disappeared', async () => {
    const { draft, doc } = await fillSaveAndCrash();
    doc.querySelector('input[name="preferred_contact"][value="phone"]')!.remove();

    const result = restoreDraft(draft, doc);
    expect(result.skipped).toBe(1);
  });

  it('restores unicode values byte for byte', async () => {
    const { draft, doc } = await fillSaveAndCrash();
    restoreDraft(draft, doc);
    expect((doc.getElementById('full_name') as HTMLInputElement).value).toBe(SAFE_VALUES.full_name);
    expect((doc.getElementById('comment') as HTMLTextAreaElement).value).toBe(SAFE_VALUES.comment);
  });

  it('survives a wholly different page without touching anything', async () => {
    const { draft } = await fillSaveAndCrash();
    const doc = mountPage('<form><input type="text" id="unrelated" name="unrelated" /></form>', PAGE);

    const result = restoreDraft(draft, doc);
    expect(result).toEqual({ restored: 0, skipped: 14 });
    expect((doc.getElementById('unrelated') as HTMLInputElement).value).toBe('');
  });

  it('restores multi-select values', () => {
    const doc = mountPage(
      `<form><select id="langs" name="langs" multiple>
         <option value="en">EN</option><option value="ru">RU</option><option value="pt">PT</option>
       </select></form>`,
      PAGE,
    );
    const draft: Draft = {
      version: 1,
      pageId: PAGE,
      origin: 'https://forms.example.com',
      path: '/apply',
      title: '',
      savedAt: Date.now(),
      skippedSensitive: 0,
      fields: [
        { by: 'id', key: 'langs', formIndex: 0, index: 0, kind: 'select-multiple', value: ['en', 'pt'] },
      ],
    };
    expect(restoreDraft(draft, doc)).toEqual({ restored: 1, skipped: 0 });
    const selected = Array.from((doc.getElementById('langs') as HTMLSelectElement).selectedOptions);
    expect(selected.map((o) => o.value)).toEqual(['en', 'pt']);
  });
});
