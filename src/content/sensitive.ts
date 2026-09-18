/**
 * Sensitive-field detection.
 *
 * Form Rescue must never persist secrets. This module is intentionally the most
 * conservative part of the codebase: when a control is ambiguous it is treated
 * as sensitive and skipped.
 *
 * Detection is metadata-based (type, autocomplete, name, id, placeholder,
 * accessible label). It is a heuristic, not a guarantee - see README.
 */

/** Input types that are never saved, whatever their name says. */
export const BLOCKED_INPUT_TYPES = new Set(['password', 'hidden', 'file', 'image']);

/** Input types Form Rescue knows how to save and restore. */
export const SUPPORTED_INPUT_TYPES = new Set([
  'text',
  'email',
  'tel',
  'number',
  'date',
  'search',
  'url',
  'checkbox',
  'radio',
]);

/**
 * `autocomplete` tokens that mark a control as secret. Any `cc-*` token is
 * blocked wholesale because payment data has no business being cached.
 */
export const BLOCKED_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
]);

/**
 * Short, ambiguous words that must only match as whole tokens.
 *
 * Substring matching would be a disaster here: "company" contains "pan",
 * "shipping" contains "pin", and "captcha" contains "pt".
 */
const BLOCKED_WORDS = new Set([
  'pass',
  'passwd',
  'pwd',
  'pw',
  'pin',
  'pincode',
  'pan',
  'otp',
  'cvv',
  'cvv2',
  'cvc',
  'cvc2',
  'csc',
  'cid',
  'totp',
  'mfa',
  'twofa',
  '2fa',
  'token',
  'secret',
  'auth',
  'ssn',
  'iban',
  'bic',
  'swift',
  'seed',
  'mnemonic',
  'otc',
]);

/**
 * Distinctive multi-word phrases. Matched against a separator-free form of the
 * metadata, so `cardNumber`, `card-number`, `card_number`, `Card Number` and
 * `cardnumber` are all caught by the single pattern `cardnumber`.
 */
const BLOCKED_PHRASES = [
  'password',
  'passcode',
  'passphrase',
  'securitycode',
  'securityanswer',
  'securityquestion',
  'cardnumber',
  'cardnum',
  'creditcard',
  'debitcard',
  'ccnumber',
  'ccnum',
  'cardcvv',
  'cardcvc',
  'cardexpiry',
  'cardexp',
  'accountnumber',
  'routingnumber',
  'sortcode',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearertoken',
  'authtoken',
  'sessiontoken',
  'csrftoken',
  'xsrftoken',
  'authorization',
  'apikey',
  'apisecret',
  'clientsecret',
  'privatekey',
  'secretkey',
  'onetimecode',
  'onetimepassword',
  'verificationcode',
  'confirmationcode',
  'socialsecurity',
  'taxid',
  'creditscore',
  'recoverycode',
  'backupcode',
  'seedphrase',
  'token',
  'secret',
];

/**
 * Normalises a metadata string into lowercase words.
 *
 * `cardNumber` -> `card number`, `CARD_NUMBER` -> `card number`,
 * `card-number` -> `card number`.
 */
export function normalize(raw: string): string {
  return raw
    // split camelCase / PascalCase boundaries
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // split letter/digit boundaries so "cvv2" keeps its shape but "otp1" splits
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when any blocked word or phrase appears in this single metadata value. */
export function matchesSensitivePattern(raw: string): boolean {
  if (!raw) return false;
  const spaced = normalize(raw);
  if (!spaced) return false;

  const words = spaced.split(' ');
  for (const word of words) {
    if (BLOCKED_WORDS.has(word)) return true;
  }

  // Re-join without separators so multi-word phrases and glued spellings match.
  const compact = spaced.replace(/ /g, '');
  for (const phrase of BLOCKED_PHRASES) {
    if (compact.includes(phrase)) return true;
  }

  // "cvv 2" / "cvc 2" style splits produced by the digit-boundary rule above.
  for (let i = 0; i < words.length - 1; i += 1) {
    const pair = `${words[i]}${words[i + 1]}`;
    if (BLOCKED_WORDS.has(pair)) return true;
  }

  return false;
}

/** Reads the accessible label text associated with a control. */
export function labelTextFor(el: Element): string {
  const parts: string[] = [];
  const doc = el.ownerDocument;

  const id = el.getAttribute('id');
  if (id && doc) {
    // `label[for=...]` - escape via attribute selector with quoting.
    let labels: NodeListOf<Element> | null = null;
    try {
      labels = doc.querySelectorAll(`label[for="${CSS.escape(id)}"]`);
    } catch {
      labels = null;
    }
    if (labels) {
      labels.forEach((l) => parts.push(l.textContent ?? ''));
    }
  }

  const wrapping = el.closest('label');
  if (wrapping) parts.push(wrapping.textContent ?? '');

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) parts.push(ariaLabel);

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy && doc) {
    for (const refId of labelledBy.split(/\s+/)) {
      const ref = doc.getElementById(refId);
      if (ref) parts.push(ref.textContent ?? '');
    }
  }

  return parts.join(' ');
}

/** Every metadata string that feeds detection, checked independently. */
export function sensitiveSignals(el: Element): string[] {
  return [
    el.getAttribute('name') ?? '',
    el.getAttribute('id') ?? '',
    el.getAttribute('autocomplete') ?? '',
    el.getAttribute('placeholder') ?? '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('data-testid') ?? '',
    el.getAttribute('title') ?? '',
    labelTextFor(el),
  ];
}

export interface SensitiveVerdict {
  sensitive: boolean;
  /** Machine-readable reason, handy for tests and debugging. */
  reason?: 'input-type' | 'autocomplete' | 'metadata' | 'unsupported-type';
}

/**
 * Decides whether a control may be persisted.
 *
 * Returns `sensitive: true` for anything blocked. `unsupported-type` means the
 * control is out of MVP scope rather than secret, but the effect is the same:
 * it is not saved.
 */
export function inspectSensitivity(el: Element): SensitiveVerdict {
  const tag = el.tagName.toLowerCase();

  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (BLOCKED_INPUT_TYPES.has(type)) {
      return { sensitive: true, reason: 'input-type' };
    }
    if (!SUPPORTED_INPUT_TYPES.has(type)) {
      return { sensitive: true, reason: 'unsupported-type' };
    }
  } else if (tag !== 'textarea' && tag !== 'select') {
    return { sensitive: true, reason: 'unsupported-type' };
  }

  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase().trim();
  if (autocomplete) {
    for (const token of autocomplete.split(/\s+/)) {
      if (BLOCKED_AUTOCOMPLETE.has(token)) return { sensitive: true, reason: 'autocomplete' };
      // Any payment-card autocomplete token, e.g. cc-number, cc-csc, cc-exp.
      if (token.startsWith('cc-')) return { sensitive: true, reason: 'autocomplete' };
    }
  }

  for (const signal of sensitiveSignals(el)) {
    if (matchesSensitivePattern(signal)) return { sensitive: true, reason: 'metadata' };
  }

  return { sensitive: false };
}

/** Convenience wrapper: `true` when the control must never be persisted. */
export function isSensitive(el: Element): boolean {
  return inspectSensitivity(el).sensitive;
}
