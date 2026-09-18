/**
 * Popup UI.
 *
 * Reads the draft for the active tab straight from local storage, and asks the
 * content script to restore only when the user presses the button. Restore is
 * never automatic.
 */

import type { RuntimeMessage, RuntimeResponse } from '../shared/types';
import { drafts, pageIdFromUrl } from '../storage/drafts';
import { formatAgo } from './format';

const store = drafts();

const statusEl = document.getElementById('status') as HTMLElement;
const actionsEl = document.getElementById('actions') as HTMLElement;
const restoreBtn = document.getElementById('restore') as HTMLButtonElement;
const deleteBtn = document.getElementById('delete') as HTMLButtonElement;
const ttlSelect = document.getElementById('ttl') as HTMLSelectElement;

let activeTabId: number | null = null;
let activePageId: string | null = null;

function renderEmpty(message = 'No saved draft for this page.'): void {
  statusEl.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = message;
  statusEl.appendChild(p);
  actionsEl.hidden = true;
}

function renderDraft(savedAt: number, fieldCount: number, skippedSensitive: number): void {
  statusEl.innerHTML = '';

  const title = document.createElement('p');
  title.className = 'title ok';
  title.textContent = '✓ Draft available';
  statusEl.appendChild(title);

  const dl = document.createElement('dl');
  const rows: Array<[string, string]> = [
    ['Saved', formatAgo(savedAt)],
    ['Fields', String(fieldCount)],
  ];
  if (skippedSensitive > 0) rows.push(['Skipped (sensitive)', String(skippedSensitive)]);

  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  statusEl.appendChild(dl);
  actionsEl.hidden = false;
}

function renderRestoreResult(restored: number, skipped: number): void {
  const wrap = document.createElement('div');
  wrap.className = 'result';

  const ok = document.createElement('p');
  ok.className = 'line';
  ok.textContent = `${restored} field${restored === 1 ? '' : 's'} restored`;
  wrap.appendChild(ok);

  if (skipped > 0) {
    const skip = document.createElement('p');
    skip.className = 'line skip';
    skip.textContent = `${skipped} field${skipped === 1 ? '' : 's'} skipped`;
    wrap.appendChild(skip);
  }

  statusEl.appendChild(wrap);
}

function sendToTab(tabId: number, message: RuntimeMessage): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response: RuntimeResponse | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false, error: 'Form Rescue is not active on this page. Reload the page and try again.' });
        return;
      }
      resolve(response);
    });
  });
}

async function load(): Promise<void> {
  const settings = await store.getSettings();
  ttlSelect.value = String(settings.ttlDays);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    renderEmpty('This page is not supported.');
    return;
  }
  activeTabId = tab.id;

  // `tab.url` is only readable with the `activeTab` grant or the much broader
  // `tabs` permission, so the content script - which always knows where it is -
  // is asked first. `tab.url` is only a fallback.
  const state = await sendToTab(tab.id, { type: 'FORM_RESCUE_STATE' });
  activePageId =
    state.ok && state.type === 'STATE'
      ? state.pageId
      : tab.url
        ? pageIdFromUrl(tab.url)
        : null;

  if (!activePageId) {
    renderEmpty('Form Rescue is not active on this page.');
    return;
  }

  const draft = await store.loadDraft(activePageId);
  if (!draft) {
    renderEmpty();
    return;
  }
  renderDraft(draft.savedAt, draft.fields.length, draft.skippedSensitive);
}

restoreBtn.addEventListener('click', async () => {
  if (activeTabId === null) return;
  restoreBtn.disabled = true;
  deleteBtn.disabled = true;

  const response = await sendToTab(activeTabId, { type: 'FORM_RESCUE_RESTORE' });
  if (!response.ok) {
    renderEmpty(response.error);
    return;
  }
  if (response.type === 'RESTORED') {
    renderRestoreResult(response.result.restored, response.result.skipped);
    actionsEl.hidden = true;
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!activePageId) return;
  restoreBtn.disabled = true;
  deleteBtn.disabled = true;
  await store.deleteDraft(activePageId);
  renderEmpty('Draft deleted.');
});

ttlSelect.addEventListener('change', async () => {
  await store.setSettings({ ttlDays: Number(ttlSelect.value) });
  await store.purgeExpired();
  if (activePageId) {
    const draft = await store.loadDraft(activePageId);
    if (!draft) renderEmpty();
  }
});

void load();
