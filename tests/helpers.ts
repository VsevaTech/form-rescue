import type { StorageArea } from '../src/storage/drafts';

/** In-memory stand-in for `chrome.storage.local`, with a structured-clone copy. */
export function memoryArea(initial: Record<string, unknown> = {}) {
  let data: Record<string, unknown> = structuredClone(initial);

  const area: StorageArea = {
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in data) out[key] = structuredClone(data[key]);
      }
      return out;
    },
    async set(items) {
      data = { ...data, ...structuredClone(items) };
    },
    async remove(keys) {
      for (const key of keys) delete data[key];
    },
  };

  return {
    area,
    snapshot: () => structuredClone(data),
    raw: () => JSON.stringify(data),
  };
}

/**
 * Renders HTML into the jsdom document and points it at a given URL.
 *
 * The jsdom origin is fixed to https://forms.example.com (see vitest.config.ts),
 * so only the path and query are swapped here - exactly what a real navigation
 * inside one site does.
 */
export function mountPage(html: string, url = 'https://forms.example.com/apply'): Document {
  const parsed = new URL(url, 'https://forms.example.com');
  window.history.replaceState({}, '', `${parsed.pathname}${parsed.search}`);
  document.documentElement.innerHTML = `<head><title>Test page</title></head><body>${html}</body>`;
  return document;
}

export const LONG_FORM_HTML = `
  <form id="application">
    <label for="full_name">Full name</label>
    <input type="text" id="full_name" name="full_name" />

    <label for="email">Email</label>
    <input type="email" id="email" name="email" />

    <label for="phone">Phone</label>
    <input type="tel" id="phone" name="phone" />

    <label for="company">Company</label>
    <input type="text" id="company" name="company" />

    <label for="job_title">Job title</label>
    <input type="text" id="job_title" name="job_title" />

    <label for="address">Address</label>
    <input type="text" id="address" name="address" />

    <label for="city">City</label>
    <input type="text" id="city" name="city" />

    <label for="postal_code">Postal code</label>
    <input type="text" id="postal_code" name="postal_code" />

    <label for="team_size">Team size</label>
    <input type="number" id="team_size" name="team_size" />

    <label for="start_date">Start date</label>
    <input type="date" id="start_date" name="start_date" />

    <label for="country">Country</label>
    <select id="country" name="country">
      <option value=""></option>
      <option value="ae">United Arab Emirates</option>
      <option value="pt">Portugal</option>
    </select>

    <label for="comment">Comment</label>
    <textarea id="comment" name="comment"></textarea>

    <label><input type="radio" name="preferred_contact" value="email" /> Email</label>
    <label><input type="radio" name="preferred_contact" value="phone" /> Phone</label>

    <label><input type="checkbox" id="newsletter" name="newsletter" value="yes" /> Newsletter</label>

    <label for="account_password">Password</label>
    <input type="password" id="account_password" name="password" autocomplete="new-password" />

    <label for="cardNumber">Card number</label>
    <input type="text" id="cardNumber" name="cardNumber" autocomplete="cc-number" />

    <label for="cvv">CVV</label>
    <input type="text" id="cvv" name="cvv" autocomplete="cc-csc" />

    <label for="otp">One-time code</label>
    <input type="text" id="otp" name="otp" autocomplete="one-time-code" />

    <input type="hidden" name="csrf_token" value="hidden-secret-value" />
    <input type="file" id="attachment" name="attachment" />
  </form>
`;

/** The 14 safe values used by the end-to-end privacy test. */
export const SAFE_VALUES: Record<string, string> = {
  full_name: 'Жанна Д’Арк',
  email: 'jeanne@example.com',
  phone: '+971500000000',
  company: 'Acme LLC',
  job_title: 'Head of Payments',
  address: '12 Marina Walk',
  city: 'Dubai',
  postal_code: '00000',
  team_size: '42',
  start_date: '2026-10-01',
  comment: 'Twenty minutes of typing — 🎉 unicode included.',
};

export const SENSITIVE_VALUES: Record<string, string> = {
  account_password: 'hunter2-super-secret',
  cardNumber: '4242424242424242',
  cvv: '321',
  otp: '998877',
};

/** Fills the long form with the 14 safe values plus the 4 sensitive ones. */
export function fillLongForm(doc: Document): void {
  for (const [id, value] of Object.entries(SAFE_VALUES)) {
    const el = doc.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
    el.value = value;
  }
  (doc.getElementById('country') as HTMLSelectElement).value = 'ae';
  (doc.getElementById('newsletter') as HTMLInputElement).checked = true;
  const radio = doc.querySelector<HTMLInputElement>('input[name="preferred_contact"][value="phone"]');
  if (radio) radio.checked = true;

  for (const [id, value] of Object.entries(SENSITIVE_VALUES)) {
    (doc.getElementById(id) as HTMLInputElement).value = value;
  }
}
