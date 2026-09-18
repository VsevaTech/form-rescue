/**
 * The test that decides whether this project may ship.
 *
 * A realistic long form is filled with 14 safe values plus a password, a card
 * number, a CVV and an OTP. Whatever ends up in storage must contain the 14 -
 * and not a single byte of the other four.
 */
import { describe, expect, it } from 'vitest';
import { createAutosave } from '../src/content/autosave';
import { collectFields } from '../src/content/fields';
import { createDraftStore } from '../src/storage/drafts';
import {
  LONG_FORM_HTML,
  SAFE_VALUES,
  SENSITIVE_VALUES,
  fillLongForm,
  memoryArea,
  mountPage,
} from './helpers';

const PAGE = 'https://forms.example.com/apply';

async function saveFilledForm() {
  const doc = mountPage(LONG_FORM_HTML, PAGE);
  fillLongForm(doc);
  const mem = memoryArea();
  const store = createDraftStore(mem.area);
  await createAutosave({ doc, store }).flush();
  return { doc, mem, store };
}

describe('critical privacy guarantee', () => {
  it('stores exactly the 14 safe fields and nothing else', async () => {
    const { store } = await saveFilledForm();
    const draft = (await store.loadDraft(PAGE))!;

    expect(draft.fields).toHaveLength(14);
    expect(draft.fields.map((f) => f.key).sort()).toEqual(
      [
        'address',
        'city',
        'comment',
        'company',
        'country',
        'email',
        'full_name',
        'job_title',
        'newsletter',
        'phone',
        'postal_code',
        'preferred_contact',
        'start_date',
        'team_size',
      ].sort(),
    );
  });

  it('never writes a sensitive value into the storage area', async () => {
    const { mem } = await saveFilledForm();
    const serialized = mem.raw();

    for (const [field, value] of Object.entries(SENSITIVE_VALUES)) {
      expect(serialized, `${field} leaked into storage`).not.toContain(value);
    }
    expect(serialized).not.toContain('hidden-secret-value');
  });

  it('never writes a sensitive field identifier into the storage area', async () => {
    const { mem } = await saveFilledForm();
    const serialized = mem.raw().toLowerCase();

    for (const key of ['password', 'cardnumber', 'cvv', 'otp', 'csrf_token', 'attachment']) {
      expect(serialized, `${key} leaked into storage`).not.toContain(key);
    }
  });

  it('does keep every safe value, so the guarantee is not achieved by saving nothing', async () => {
    const { mem } = await saveFilledForm();
    const serialized = mem.raw();
    for (const value of Object.values(SAFE_VALUES)) {
      expect(serialized).toContain(JSON.stringify(value).slice(1, -1));
    }
  });

  it.each([
    ['password input', '<input type="password" id="f" name="whatever" value="s3cr3t" />'],
    ['hidden input', '<input type="hidden" id="f" name="state" value="s3cr3t" />'],
    ['file input', '<input type="file" id="f" name="doc" />'],
    ['card number by name', '<input type="text" id="f" name="cardNumber" value="s3cr3t" />'],
    ['card number by id', '<input type="text" id="card_number" value="s3cr3t" />'],
    ['CVV', '<input type="text" id="f" name="cvv" value="s3cr3t" />'],
    ['CVC', '<input type="text" id="f" name="cvc" value="s3cr3t" />'],
    ['OTP', '<input type="text" id="f" name="otp" value="s3cr3t" />'],
    ['PIN', '<input type="text" id="f" name="pin" value="s3cr3t" />'],
    ['access token', '<input type="text" id="f" name="access_token" value="s3cr3t" />'],
    ['refresh token', '<input type="text" id="f" name="refresh_token" value="s3cr3t" />'],
    ['api key', '<input type="text" id="f" name="api_key" value="s3cr3t" />'],
    ['private key', '<textarea id="f" name="private_key">s3cr3t</textarea>'],
    ['authorization', '<input type="text" id="f" name="Authorization" value="s3cr3t" />'],
    ['security code by label', '<label for="f">Security code</label><input type="text" id="f" name="q" value="s3cr3t" />'],
    ['cvv by placeholder', '<input type="text" id="f" name="q" placeholder="CVV" value="s3cr3t" />'],
    ['otp by autocomplete', '<input type="text" id="f" name="q" autocomplete="one-time-code" value="s3cr3t" />'],
    ['card by autocomplete', '<input type="text" id="f" name="q" autocomplete="cc-number" value="s3cr3t" />'],
    ['password by autocomplete', '<input type="text" id="f" name="q" autocomplete="current-password" value="s3cr3t" />'],
  ])('never saves: %s', async (_label, markup) => {
    const doc = mountPage(`<form>${markup}<input type="text" id="safe" name="city" value="Dubai" /></form>`, PAGE);
    const mem = memoryArea();
    const store = createDraftStore(mem.area);
    await createAutosave({ doc, store }).flush();

    expect(mem.raw()).not.toContain('s3cr3t');
    expect(mem.raw()).toContain('Dubai');
    expect(collectFields(doc).fields.map((f) => f.key)).toEqual(['safe']);
  });

  it('is not defeated by separator or case variants of a blocked name', async () => {
    const variants = ['cardNumber', 'card-number', 'card_number', 'CARD NUMBER', 'cardnumber', 'CardNumber'];
    for (const [i, name] of variants.entries()) {
      const doc = mountPage(`<form><input type="text" name="${name}" value="leak-${i}" /></form>`, PAGE);
      const mem = memoryArea();
      const store = createDraftStore(mem.area);
      await createAutosave({ doc, store }).flush();
      expect(mem.raw(), `variant ${name} leaked`).not.toContain(`leak-${i}`);
    }
  });
});
