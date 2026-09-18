/**
 * Content script entry point.
 *
 * Wires autosave to the page and answers messages from the popup. All state
 * lives in `chrome.storage.local`; nothing is sent anywhere.
 */

import type { RuntimeMessage, RuntimeResponse } from '../shared/types';
import { drafts, pageIdFromUrl } from '../storage/drafts';
import { createAutosave } from './autosave';
import { showSavedIndicator } from './indicator';
import { restoreDraft } from './restore';

const store = drafts();

const autosave = createAutosave({
  doc: document,
  store,
  onSaved: () => showSavedIndicator(document),
});

autosave.start();

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse: (response: RuntimeResponse) => void) => {
    if (message?.type === 'FORM_RESCUE_PING') {
      sendResponse({ ok: true, type: 'PONG' });
      return false;
    }

    if (message?.type === 'FORM_RESCUE_STATE') {
      sendResponse({ ok: true, type: 'STATE', pageId: pageIdFromUrl(location.href) });
      return false;
    }

    if (message?.type === 'FORM_RESCUE_SAVE_NOW') {
      void autosave.flush().then(
        () => sendResponse({ ok: true, type: 'SAVED' }),
        (error: unknown) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;
    }

    if (message?.type === 'FORM_RESCUE_RESTORE') {
      const pageId = pageIdFromUrl(location.href);
      if (!pageId) {
        sendResponse({ ok: false, error: 'Unsupported page.' });
        return false;
      }
      void store.loadDraft(pageId).then(
        (draft) => {
          if (!draft) {
            sendResponse({ ok: false, error: 'No saved draft for this page.' });
            return;
          }
          sendResponse({ ok: true, type: 'RESTORED', result: restoreDraft(draft, document) });
        },
        (error: unknown) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;
    }

    return false;
  },
);
