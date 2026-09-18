import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEBOUNCE_MS, createAutosave } from '../src/content/autosave';
import { createDraftStore } from '../src/storage/drafts';
import { LONG_FORM_HTML, fillLongForm, memoryArea, mountPage } from './helpers';

const PAGE = 'https://forms.example.com/apply';

function setup(url = PAGE) {
  const doc = mountPage(LONG_FORM_HTML, url);
  const mem = memoryArea();
  const store = createDraftStore(mem.area);
  return { doc, mem, store };
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('autosave debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not write on every keystroke', async () => {
    const { doc, store } = setup();
    const autosave = createAutosave({ doc, store, debounceMs: DEFAULT_DEBOUNCE_MS });
    autosave.start();

    const field = doc.getElementById('full_name') as HTMLInputElement;
    for (const value of ['J', 'Ja', 'Jan', 'Jane']) {
      type(field, value);
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(autosave.writes).toBe(0);

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(autosave.writes).toBe(1);

    const draft = await store.loadDraft(PAGE);
    expect(draft?.fields.find((f) => f.key === 'full_name')?.value).toBe('Jane');
  });

  it('writes once per quiet period, not once per event', async () => {
    const { doc, store } = setup();
    const autosave = createAutosave({ doc, store, debounceMs: 500 });
    autosave.start();

    const field = doc.getElementById('comment') as HTMLTextAreaElement;
    type(field, 'a');
    await vi.advanceTimersByTimeAsync(600);
    type(field, 'ab');
    await vi.advanceTimersByTimeAsync(600);

    expect(autosave.writes).toBe(2);
  });

  it('reacts to change events from selects, checkboxes and radios', async () => {
    const { doc, store } = setup();
    const autosave = createAutosave({ doc, store, debounceMs: 300 });
    autosave.start();

    const select = doc.getElementById('country') as HTMLSelectElement;
    select.value = 'pt';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);

    const draft = await store.loadDraft(PAGE);
    expect(draft?.fields.find((f) => f.key === 'country')?.value).toBe('pt');
  });

  it('stops listening after stop()', async () => {
    const { doc, store } = setup();
    const autosave = createAutosave({ doc, store, debounceMs: 200 });
    autosave.start();
    autosave.stop();

    type(doc.getElementById('city') as HTMLInputElement, 'Dubai');
    await vi.advanceTimersByTimeAsync(500);
    expect(autosave.writes).toBe(0);
  });

  it('drops the draft on form submit', async () => {
    const { doc, store } = setup();
    const autosave = createAutosave({ doc, store, debounceMs: 100 });
    autosave.start();

    type(doc.getElementById('city') as HTMLInputElement, 'Dubai');
    await vi.advanceTimersByTimeAsync(200);
    expect(await store.loadDraft(PAGE)).not.toBeNull();

    doc.getElementById('application')!.dispatchEvent(new Event('submit', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(await store.loadDraft(PAGE)).toBeNull();
  });
});

describe('autosave content', () => {
  it('writes nothing for an untouched form', async () => {
    const { doc, store } = setup();
    const autosave = createAutosave({ doc, store });
    expect(await autosave.flush()).toBeNull();
    expect(await store.loadDraft(PAGE)).toBeNull();
  });

  it('removes an existing draft once the form is emptied again', async () => {
    const { doc, store } = setup();
    const autosave = createAutosave({ doc, store });

    (doc.getElementById('city') as HTMLInputElement).value = 'Dubai';
    await autosave.flush();
    expect(await store.loadDraft(PAGE)).not.toBeNull();

    (doc.getElementById('city') as HTMLInputElement).value = '';
    await autosave.flush();
    expect(await store.loadDraft(PAGE)).toBeNull();
  });

  it('stores page metadata alongside the fields', async () => {
    const { doc, store } = setup();
    fillLongForm(doc);
    const fixedNow = Date.now();
    const autosave = createAutosave({ doc, store, clock: () => fixedNow });
    await autosave.flush();

    const draft = await store.loadDraft(PAGE);
    expect(draft).toMatchObject({
      pageId: PAGE,
      origin: 'https://forms.example.com',
      path: '/apply',
      savedAt: fixedNow,
      skippedSensitive: 6,
    });
    expect(draft?.fields).toHaveLength(14);
  });

  it('keeps drafts of different pages apart', async () => {
    const a = setup('https://forms.example.com/apply');
    (a.doc.getElementById('city') as HTMLInputElement).value = 'Dubai';
    await createAutosave({ doc: a.doc, store: a.store }).flush();

    const b = setup('https://forms.example.com/other');
    (b.doc.getElementById('city') as HTMLInputElement).value = 'Lisbon';
    await createAutosave({ doc: b.doc, store: a.store }).flush();

    const first = await a.store.loadDraft('https://forms.example.com/apply');
    const second = await a.store.loadDraft('https://forms.example.com/other');
    expect(first?.fields.find((f) => f.key === 'city')?.value).toBe('Dubai');
    expect(second?.fields.find((f) => f.key === 'city')?.value).toBe('Lisbon');
  });

  it('ignores the query string when keying the draft', async () => {
    const a = setup('https://forms.example.com/apply?session=one');
    (a.doc.getElementById('city') as HTMLInputElement).value = 'Dubai';
    await createAutosave({ doc: a.doc, store: a.store }).flush();

    expect(await a.store.loadDraft('https://forms.example.com/apply')).not.toBeNull();
    expect(a.mem.raw()).not.toContain('session=one');
  });
});
