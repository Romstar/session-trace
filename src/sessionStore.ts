/**
 * In-memory event log. One list per session, capped at 2000 events.
 */

import { isEventType, type AgentEvent } from './shared/events';
import type { SessionSnapshot } from './shared/messages';
import { MAX_DETAIL_CHARS, MAX_EVENTS_PER_SESSION } from './shared/paths';

export interface IncomingEvent {
  sessionId: string;
  ts: number;
  type: AgentEvent['type'];
  label: string;
  detail?: Record<string, unknown>;
}

export class SessionStore {
  private readonly sessions = new Map<string, AgentEvent[]>();
  private readonly nextSeq = new Map<string, number>();
  /** subagent id -> parent session, so later child events can join the parent graph. */
  private readonly subagentParents = new Map<string, { parentSessionId: string; toolCallId?: string }>();
  private readonly listeners = new Set<() => void>();
  private lastEncoded = '';

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  add(input: IncomingEvent): AgentEvent {
    const annotated = this.annotateSession(input.sessionId, input.detail);
    const detail = this.linkSubagent(annotated);
    const seq = (this.nextSeq.get(input.sessionId) ?? 0) + 1;
    this.nextSeq.set(input.sessionId, seq);

    const event: AgentEvent = {
      sessionId: input.sessionId,
      seq,
      ts: input.ts,
      type: input.type,
      label: input.label,
      detail: this.capDetail(detail),
    };

    const list = this.sessions.get(input.sessionId) ?? [];
    list.push(event);
    if (list.length > MAX_EVENTS_PER_SESSION) {
      list.splice(0, list.length - MAX_EVENTS_PER_SESSION);
    }
    this.sessions.set(input.sessionId, list);
    this.emit();
    return event;
  }

  clear(sessionId: string | null): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
      this.nextSeq.delete(sessionId);
    } else {
      this.sessions.clear();
      this.nextSeq.clear();
      this.subagentParents.clear();
    }
    this.emit();
  }

  /** Replace the log with a snapshot from the shared ingest server. */
  replace(snapshots: SessionSnapshot[]): void {
    const encoded = JSON.stringify(snapshots);
    if (encoded === this.lastEncoded) {
      return;
    }
    this.lastEncoded = encoded;
    this.sessions.clear();
    this.nextSeq.clear();
    for (const snapshot of snapshots) {
      this.sessions.set(snapshot.sessionId, snapshot.events.slice());
      const maxSeq = snapshot.events.reduce((max, event) => Math.max(max, event.seq), 0);
      this.nextSeq.set(snapshot.sessionId, maxSeq);
    }
    this.emit();
  }

  snapshots(): SessionSnapshot[] {
    const items: SessionSnapshot[] = [];
    for (const [sessionId, events] of this.sessions) {
      items.push({ sessionId, events: events.slice() });
    }
    items.sort((a, b) => {
      const aTs = a.events[a.events.length - 1]?.ts ?? 0;
      const bTs = b.events[b.events.length - 1]?.ts ?? 0;
      return aTs - bTs;
    });
    return items;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  static parseIncoming(value: unknown): IncomingEvent | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.sessionId !== 'string' || !record.sessionId.trim()) {
      return null;
    }
    if (!isEventType(record.type) || typeof record.label !== 'string') {
      return null;
    }
    const ts = typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : Date.now();
    const detail =
      record.detail && typeof record.detail === 'object' && !Array.isArray(record.detail)
        ? (record.detail as Record<string, unknown>)
        : undefined;
    return {
      sessionId: record.sessionId,
      ts,
      type: record.type,
      label: record.label,
      detail,
    };
  }

  private linkSubagent(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    const next = detail ? { ...detail } : undefined;
    if (!next) {
      return next;
    }
    const subagentId = typeof next.subagentId === 'string' ? next.subagentId : '';
    const parent = typeof next.parentSessionId === 'string' ? next.parentSessionId : '';
    const toolCallId = typeof next.toolCallId === 'string' ? next.toolCallId : undefined;
    if (subagentId && parent) {
      this.subagentParents.set(subagentId, { parentSessionId: parent, toolCallId });
    }
    return next;
  }

  /** Called with the session id so child conversations inherit the parent link. */
  annotateSession(sessionId: string, detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    const link = this.subagentParents.get(sessionId);
    if (!link) {
      return detail;
    }
    return {
      ...detail,
      parentSessionId: link.parentSessionId,
      subagentId: sessionId,
      ...(link.toolCallId && !detail?.toolCallId ? { toolCallId: link.toolCallId } : {}),
    };
  }

  private capDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!detail) {
      return undefined;
    }
    const raw = JSON.stringify(detail);
    if (raw.length <= MAX_DETAIL_CHARS) {
      return detail;
    }
    return {
      truncated: true,
      preview: raw.slice(0, MAX_DETAIL_CHARS),
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
