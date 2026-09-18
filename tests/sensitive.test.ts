import { describe, expect, it } from 'vitest';
import {
  inspectSensitivity,
  isSensitive,
  matchesSensitivePattern,
  normalize,
} from '../src/content/sensitive';

function input(attrs: Record<string, string>, extraHtml = ''): HTMLElement {
  const attrString = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  document.body.innerHTML = `${extraHtml}<input ${attrString} />`;
  return document.querySelector('input') as HTMLElement;
}

describe('normalize', () => {
  it.each([
    ['cardNumber', 'card number'],
    ['card-number', 'card number'],
    ['card_number', 'card number'],
    ['Card Number', 'card number'],
    ['CARD_NUMBER', 'card number'],
    ['CardNumber', 'card number'],
    ['user.creditCard', 'user credit card'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalize(raw)).toBe(expected);
  });
});

describe('matchesSensitivePattern', () => {
  it.each([
    'password',
    'passwd',
    'pwd',
    'passcode',
    'userPin',
    'pin_code',
    'otp',
    'otpCode',
    'cvv',
    'cvc',
    'CVV2',
    'security code',
    'Security Code',
    'cardNumber',
    'card-number',
    'card_number',
    'cardnumber',
    'credit card',
    'pan',
    'access_token',
    'refresh_token',
    'Authorization',
    'secret',
    'api_key',
    'apiKey',
    'private_key',
    'one-time-code',
    'clientSecret',
    'ssn',
    'iban',
  ])('flags %s', (value) => {
    expect(matchesSensitivePattern(value)).toBe(true);
  });

  it.each([
    'full_name',
    'email',
    'phone',
    'company',
    'companyName',
    'job_title',
    'address',
    'shipping_address',
    'city',
    'country',
    'postal_code',
    'comment',
    'preferred_contact',
    'newsletter',
    'team_size',
    'start_date',
    'Panama office',
    'Spinning class',
    'department',
    'notes',
  ])('allows %s', (value) => {
    expect(matchesSensitivePattern(value)).toBe(false);
  });

  it('does not match short blocked words as substrings', () => {
    // "company" contains "pan", "shipping" contains "pin".
    expect(matchesSensitivePattern('company')).toBe(false);
    expect(matchesSensitivePattern('shipping')).toBe(false);
    expect(matchesSensitivePattern('opinion')).toBe(false);
  });
});

describe('inspectSensitivity: input types', () => {
  it('never saves password inputs', () => {
    expect(inspectSensitivity(input({ type: 'password', name: 'anything' }))).toEqual({
      sensitive: true,
      reason: 'input-type',
    });
  });

  it('never saves hidden inputs', () => {
    expect(inspectSensitivity(input({ type: 'hidden', name: 'csrf' })).reason).toBe('input-type');
  });

  it('never saves file inputs', () => {
    expect(inspectSensitivity(input({ type: 'file', name: 'attachment' })).reason).toBe('input-type');
  });

  it('skips input types outside MVP scope', () => {
    expect(inspectSensitivity(input({ type: 'color', name: 'brand' })).reason).toBe(
      'unsupported-type',
    );
  });

  it('allows supported plain types', () => {
    for (const type of ['text', 'email', 'tel', 'number', 'date', 'checkbox', 'radio']) {
      expect(isSensitive(input({ type, name: 'full_name' }))).toBe(false);
    }
  });

  it('allows textarea and select', () => {
    document.body.innerHTML = '<textarea name="comment"></textarea><select name="country"></select>';
    expect(isSensitive(document.querySelector('textarea') as Element)).toBe(false);
    expect(isSensitive(document.querySelector('select') as Element)).toBe(false);
  });
});

describe('inspectSensitivity: autocomplete', () => {
  it.each(['current-password', 'new-password', 'cc-number', 'cc-csc', 'one-time-code', 'cc-exp'])(
    'never saves autocomplete=%s',
    (value) => {
      expect(inspectSensitivity(input({ type: 'text', name: 'value', autocomplete: value }))).toEqual(
        { sensitive: true, reason: 'autocomplete' },
      );
    },
  );

  it('allows benign autocomplete tokens', () => {
    for (const value of ['name', 'email', 'tel', 'organization', 'street-address', 'country-name']) {
      expect(isSensitive(input({ type: 'text', name: 'field', autocomplete: value }))).toBe(false);
    }
  });
});

describe('inspectSensitivity: metadata sources', () => {
  it('excludes a text input named cardNumber', () => {
    expect(inspectSensitivity(input({ type: 'text', name: 'cardNumber' }))).toEqual({
      sensitive: true,
      reason: 'metadata',
    });
  });

  it('detects via id', () => {
    expect(isSensitive(input({ type: 'text', id: 'card_number' }))).toBe(true);
  });

  it('detects via placeholder', () => {
    expect(isSensitive(input({ type: 'text', name: 'q1', placeholder: 'Enter your CVV' }))).toBe(true);
  });

  it('detects via aria-label', () => {
    expect(isSensitive(input({ type: 'text', name: 'q2', 'aria-label': 'Access token' }))).toBe(true);
  });

  it('detects via a label[for] element', () => {
    const el = input({ type: 'text', name: 'q3', id: 'q3' }, '<label for="q3">Security code</label>');
    expect(isSensitive(el)).toBe(true);
  });

  it('detects via a wrapping label', () => {
    document.body.innerHTML = '<label>Card Number <input type="text" name="q4" /></label>';
    expect(isSensitive(document.querySelector('input') as Element)).toBe(true);
  });

  it('detects via aria-labelledby', () => {
    document.body.innerHTML =
      '<span id="lbl">One-time password</span><input type="text" name="q5" aria-labelledby="lbl" />';
    expect(isSensitive(document.querySelector('input') as Element)).toBe(true);
  });

  it('keeps ordinary contact fields savable', () => {
    const el = input({ type: 'text', name: 'company', id: 'company', placeholder: 'Acme LLC' },
      '<label for="company">Company</label>');
    expect(isSensitive(el)).toBe(false);
  });
});
