/**
 * DFA badge state, derived from the latest event of a session.
 */

import type { AgentEvent } from './events';
import type { SessionSnapshot } from './messages';

export const DFA_STATES = [
  'THINKING',
  'ACTING',
  'OBSERVING',
  'WAITING',
  'DONE',
  'ERROR',
] as const;

export type DfaState = (typeof DFA_STATES)[number];

/**
 * Map the latest event to a badge.
 * file_edit has no close event, so it stays ACTING.
 */
export function deriveState(events: AgentEvent[]): DfaState | null {
  if (events.length === 0) {
    return null;
  }
  const last = events[events.length - 1];
  switch (last.type) {
    case 'thought':
    case 'prompt_submit':
      return 'THINKING';
    case 'tool_start':
    case 'shell_start':
    case 'mcp_start':
    case 'file_read':
    case 'subagent_start':
    case 'file_edit':
      return 'ACTING';
    case 'tool_end':
    case 'shell_end':
    case 'mcp_end':
    case 'agent_response':
    case 'subagent_stop':
    case 'compact':
      return 'OBSERVING';
    case 'stop':
    case 'session_start':
      return 'WAITING';
    case 'session_end':
      return 'DONE';
    case 'error':
      return 'ERROR';
    default:
      return 'WAITING';
  }
}

/** Parent session id when this event belongs to a nested subagent session. */
export function parentSessionIdOf(event: AgentEvent): string | undefined {
  const value = event.detail?.parentSessionId;
  if (typeof value !== 'string' || !value || value === event.sessionId) {
    return undefined;
  }
  return value;
}

/** A session is nested when its events point at a parent session. */
export function isNestedSession(events: AgentEvent[]): boolean {
  return events.length > 0 && events.every((event) => parentSessionIdOf(event) !== undefined);
}

export function topLevelSessions(sessions: SessionSnapshot[]): SessionSnapshot[] {
  return sessions.filter((session) => !isNestedSession(session.events));
}

/** Events to draw for the selected session, plus linked subagent sessions. */
export function eventsForSession(sessions: SessionSnapshot[], selectedId: string): AgentEvent[] {
  const selected = sessions.find((session) => session.sessionId === selectedId);
  const own = selected?.events ?? [];
  const extra: AgentEvent[] = [];
  for (const session of sessions) {
    if (session.sessionId === selectedId) {
      continue;
    }
    for (const event of session.events) {
      if (parentSessionIdOf(event) === selectedId) {
        extra.push(event);
      }
    }
  }
  return [...own, ...extra].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}
