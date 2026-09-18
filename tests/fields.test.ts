import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildShortSelector,
  collectFields,
  isEmptyValue,
  kindOf,
  locatorFor,
  resolveLocator,
  type FormControl,
} from '../src/content/fields';
import { LONG_FORM_HTML, SAFE_VALUES, fillLongForm, mountPage } from './helpers';

describe('kindOf', () => {
  it('maps controls to kinds', () => {
    document.body.innerHTML = `
      <input type="text" id="a" />
      <input type="checkbox" id="b" />
      <input type="radio" id="c" />
      <textarea id="d"></textarea>
      <select id="e"></select>
      <select id="f" multiple></select>
    `;
    const k = (id: string) => kindOf(document.getElementById(id) as FormControl);
    expect(k('a')).toBe('text');
    expect(k('b')).toBe('checkbox');
    expect(k('c')).toBe('radio');
    expect(k('d')).toBe('textarea');
    expect(k('e')).toBe('select');
    expect(k('f')).toBe('select-multiple');
  });
});

describe('locatorFor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers a unique id', () => {
    document.body.innerHTML = '<form><input type="text" id="email" name="email" /></form>';
    const el = document.getElementById('email') as FormControl;
    expect(locatorFor(el, document)).toMatchObject({ by: 'id', key: 'email' });
  });

  it('falls back to name when the id is duplicated', () => {
    document.body.innerHTML =
      '<form><input type="text" id="dup" name="first" /><input type="text" id="dup" name="second" /></form>';
    const el = document.querySelector('[name="second"]') as FormControl;
    expect(locatorFor(el, document)).toMatchObject({ by: 'name', key: 'second' });
  });

  it('disambiguates repeated names by index within the form', () => {
    document.body.innerHTML =
      '<form><input type="text" name="tag" /><input type="text" name="tag" /></form>';
    const all = document.querySelectorAll('input');
    expect(locatorFor(all[0] as FormControl, document)).toMatchObject({ key: 'tag', index: 0 });
    expect(locatorFor(all[1] as FormControl, document)).toMatchObject({ key: 'tag', index: 1 });
  });

  it('falls back to a short selector when there is no id or name', () => {
    document.body.innerHTML = '<div id="box"><p></p><input type="text" /></div>';
    const el = document.querySelector('input') as FormControl;
    const locator = locatorFor(el, document);
    expect(locator?.by).toBe('selector');
    expect(locator?.key.split('>').length).toBeLessThanOrEqual(5);
    expect(resolveLocator(locator!, document)).toBe(el);
  });

  it('refuses radios without a name', () => {
    document.body.innerHTML = '<input type="radio" value="x" />';
    const el = document.querySelector('input') as FormControl;
    expect(locatorFor(el, document)).toBeNull();
  });

  it('does not build long fragile selectors', () => {
    document.body.innerHTML =
      '<div><div><div><div><div><div><input type="text" /></div></div></div></div></div></div>';
    const el = document.querySelector('input') as FormControl;
    expect(buildShortSelector(el, document)).toBeNull();
  });
});

describe('resolveLocator', () => {
  it('returns null when the element is gone', () => {
    document.body.innerHTML = '<input type="text" id="gone" />';
    const el = document.getElementById('gone') as FormControl;
    const locator = locatorFor(el, document)!;
    document.body.innerHTML = '';
    expect(resolveLocator(locator, document)).toBeNull();
  });

  it('returns null when a selector became ambiguous', () => {
    document.body.innerHTML = '<div id="box"><input type="text" /></div>';
    const el = document.querySelector('input') as FormControl;
    const locator = locatorFor(el, document)!;
    document.body.innerHTML = '<div id="box"><input type="text" /></div><input type="text" />';
    const resolved = resolveLocator({ ...locator, by: 'selector', key: 'input' }, document);
    expect(resolved).toBeNull();
  });

  it('scopes name lookups to the owning form', () => {
    document.body.innerHTML =
      '<form><input type="text" name="x" value="one" /></form><form><input type="text" name="x" value="two" /></form>';
    const second = document.forms[1]!.querySelector('input') as FormControl;
    const locator = locatorFor(second, document)!;
    expect(locator.formIndex).toBe(1);
    expect((resolveLocator(locator, document) as HTMLInputElement).value).toBe('two');
  });
});

describe('isEmptyValue', () => {
  it('treats blank strings, empty arrays and unchecked boxes as empty', () => {
    expect(isEmptyValue('text', '')).toBe(true);
    expect(isEmptyValue('checkbox', false)).toBe(true);
    expect(isEmptyValue('checkbox', true)).toBe(false);
    expect(isEmptyValue('select-multiple', [])).toBe(true);
    expect(isEmptyValue('radio', null)).toBe(true);
    expect(isEmptyValue('text', '0')).toBe(false);
  });
});

describe('collectFields', () => {
  it('returns nothing for an empty form', () => {
    mountPage(LONG_FORM_HTML);
    const result = collectFields(document);
    expect(result.fields).toHaveLength(0);
  });

  it('collects exactly the safe fields of a filled long form', () => {
    const doc = mountPage(LONG_FORM_HTML);
    fillLongForm(doc);

    const { fields, skippedSensitive } = collectFields(doc);
    const keys = fields.map((f) => f.key).sort();

    expect(fields).toHaveLength(14);
    expect(keys).toEqual(
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
    // password, cardNumber, cvv, otp, hidden csrf_token, file attachment
    expect(skippedSensitive).toBe(6);
  });

  it('keeps unicode values intact', () => {
    const doc = mountPage(LONG_FORM_HTML);
    fillLongForm(doc);
    const { fields } = collectFields(doc);
    const name = fields.find((f) => f.key === 'full_name');
    const comment = fields.find((f) => f.key === 'comment');
    expect(name?.value).toBe(SAFE_VALUES.full_name);
    expect(comment?.value).toBe(SAFE_VALUES.comment);
  });

  it('records checkbox and radio state', () => {
    const doc = mountPage(LONG_FORM_HTML);
    fillLongForm(doc);
    const { fields } = collectFields(doc);
    expect(fields.find((f) => f.key === 'newsletter')).toMatchObject({
      kind: 'checkbox',
      value: true,
    });
    expect(fields.find((f) => f.key === 'preferred_contact')).toMatchObject({
      kind: 'radio',
      value: 'phone',
    });
  });

  it('skips disabled controls', () => {
    mountPage('<form><input type="text" id="a" value="x" disabled /></form>');
    expect(collectFields(document).fields).toHaveLength(0);
  });

  it('records only one entry per radio group', () => {
    mountPage(`
      <form>
        <input type="radio" name="g" value="a" checked />
        <input type="radio" name="g" value="b" />
        <input type="radio" name="g" value="c" />
      </form>
    `);
    const { fields } = collectFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ kind: 'radio', key: 'g', value: 'a' });
  });

  it('supports multi-selects', () => {
    mountPage(`
      <form>
        <select id="langs" name="langs" multiple>
          <option value="en" selected>EN</option>
          <option value="ru" selected>RU</option>
          <option value="pt">PT</option>
        </select>
      </form>
    `);
    const { fields } = collectFields(document);
    expect(fields[0]).toMatchObject({ kind: 'select-multiple', value: ['en', 'ru'] });
  });
});
