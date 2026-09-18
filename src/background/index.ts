/**
 * Background service worker.
 *
 * Its only job is housekeeping: drop expired drafts when the browser starts and
 * when the extension is installed or updated. Expired drafts are also purged on
 * every read, so this worker is a convenience, not a dependency.
 */

import { drafts } from '../storage/drafts';

function purge(): void {
  void drafts()
    .purgeExpired()
    .catch(() => {
      /* storage unavailable - nothing to do */
    });
}

chrome.runtime.onInstalled.addListener(purge);
chrome.runtime.onStartup.addListener(purge);
