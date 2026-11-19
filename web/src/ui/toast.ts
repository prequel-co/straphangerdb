/**
 * Accessible, non-blocking toast notifications for DBTC.
 * Replaces native browser `alert()` dialogs and confirms exports, saves, and clipboard copies.
 */

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  variant?: ToastVariant;
  durationMs?: number | undefined;
}

const CONTAINER_ID = 'dbtc-toast-container';
const DEFAULT_DURATION_MS = 4000;

function ensureToastContainer(): HTMLElement {
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'dbtc-toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    container.setAttribute('role', 'status');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(
  message: string,
  variantOrOptions: ToastVariant | ToastOptions = 'info',
  durationMsArg?: number
): void {
  if (typeof document === 'undefined' || !document.body) return;

  const opts: ToastOptions =
    typeof variantOrOptions === 'string'
      ? { variant: variantOrOptions, durationMs: durationMsArg }
      : variantOrOptions;

  const variant: ToastVariant = opts.variant ?? 'info';
  const durationMs = opts.durationMs ?? (variant === 'error' ? 6000 : DEFAULT_DURATION_MS);

  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `dbtc-toast dbtc-toast--${variant}`;
  toast.setAttribute('role', variant === 'error' || variant === 'warning' ? 'alert' : 'status');

  const iconSpan = document.createElement('span');
  iconSpan.className = 'dbtc-toast__icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent =
    variant === 'success' ? '✓' : variant === 'error' ? '!' : variant === 'warning' ? '⚠' : 'ℹ';

  const msgSpan = document.createElement('span');
  msgSpan.className = 'dbtc-toast__message';
  msgSpan.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dbtc-toast__close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '×';

  let timer: ReturnType<typeof setTimeout> | null = null;
  const dismiss = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    toast.classList.add('dbtc-toast--leaving');
    setTimeout(() => toast.remove(), 180);
  };

  closeBtn.addEventListener('click', dismiss);

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  if (durationMs > 0) {
    timer = setTimeout(dismiss, durationMs);
  }
}
