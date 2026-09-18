/**
 * Small, unobtrusive "saved locally" toast.
 *
 * Secondary feature. Rendered inside a shadow root so page styles cannot leak
 * in and the extension cannot leak styles out. Shown at most once per page load.
 */

const HOST_ID = 'form-rescue-indicator-host';
const VISIBLE_MS = 2600;

let shown = false;

export function showSavedIndicator(doc: Document, text = 'Form Rescue saved this form locally.'): void {
  if (shown) return;
  if (!doc.body) return;
  shown = true;

  const host = doc.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px;';

  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = `
    .toast {
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #11161d;
      color: #e8edf3;
      border: 1px solid #2a3442;
      border-radius: 10px;
      padding: 10px 14px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity .18s ease, transform .18s ease;
    }
    .toast.in { opacity: 1; transform: translateY(0); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #35c98b; flex: none; }
  `;
  const toast = doc.createElement('div');
  toast.className = 'toast';
  const dot = doc.createElement('span');
  dot.className = 'dot';
  const label = doc.createElement('span');
  label.textContent = text;
  toast.append(dot, label);
  root.append(style, toast);
  doc.body.appendChild(host);

  requestAnimationFrame(() => toast.classList.add('in'));
  setTimeout(() => {
    toast.classList.remove('in');
    setTimeout(() => host.remove(), 250);
  }, VISIBLE_MS);
}

/** Test helper: allows the indicator to be shown again. */
export function resetIndicator(): void {
  shown = false;
}
