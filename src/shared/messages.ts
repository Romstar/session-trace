/**
 * Typed messages between the extension host and the webview.
 */

import type { AgentEvent } from './events';

export interface SessionSnapshot {
  sessionId: string;
  events: AgentEvent[];
}

/** Host -> webview. */
export type HostMessage = {
  type: 'snapshot';
  sessions: SessionSnapshot[];
  selectedSessionId: string | null;
};

/** Webview -> host. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openWindow' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'clearSession'; sessionId: string | null }
  | { type: 'copyDetail'; text: string };

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case 'ready':
    case 'openWindow':
      return true;
    case 'selectSession':
      return typeof record.sessionId === 'string';
    case 'clearSession':
      return record.sessionId === null || typeof record.sessionId === 'string';
    case 'copyDetail':
      return typeof record.text === 'string';
    default:
      return false;
  }
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === 'snapshot' && Array.isArray(record.sessions);
}
