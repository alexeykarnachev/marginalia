// App status store — manages toast notifications.

import type { ErrorSeverity } from '../core/errors';

export interface Toast {
  id: number;
  message: string;
  severity: ErrorSeverity;
  onRetry?: () => void;
}

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS: Record<ErrorSeverity, number> = {
  info: 3000,
  warning: 5000,
  error: 10000,
  fatal: 0, // never auto-dismiss
};

let _nextId = 0;
let _toasts = $state<Toast[]>([]);

export const appStatus = {
  get toasts() { return _toasts; },

  notify(message: string, severity: ErrorSeverity = 'error', onRetry?: () => void) {
    const id = ++_nextId;
    _toasts = [..._toasts.slice(-(MAX_TOASTS - 1)), { id, message, severity, onRetry }];

    const ms = AUTO_DISMISS_MS[severity];
    if (ms > 0) {
      setTimeout(() => this.dismiss(id), ms);
    }
  },

  dismiss(id: number) {
    _toasts = _toasts.filter(t => t.id !== id);
  },

  clear() {
    _toasts = [];
  },
};
