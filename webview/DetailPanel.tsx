import { useState } from 'react';
import type { AgentEvent } from '../src/shared/events';

interface DetailPanelProps {
  event: AgentEvent | null;
  onCopy: (text: string) => void;
}

export function DetailPanel({ event, onCopy }: DetailPanelProps) {
  const [copied, setCopied] = useState(false);

  if (!event) {
    return (
      <aside className="ag-detail">
        <h2>Detail</h2>
        <p className="ag-muted">Select a node to see the full label, time, and payload.</p>
      </aside>
    );
  }

  const payload = {
    label: event.label,
    type: event.type,
    sessionId: event.sessionId,
    seq: event.seq,
    ts: event.ts,
    detail: event.detail ?? {},
  };
  const text = JSON.stringify(payload, null, 2);

  return (
    <aside className="ag-detail">
      <h2>Detail</h2>
      <p className="ag-detail-label">{event.label}</p>
      <p className="ag-muted">{formatTime(event.ts)}</p>
      <p className="ag-meta">
        {event.type}, seq {event.seq}
      </p>
      <button
        type="button"
        className="ag-button"
        onClick={() => {
          onCopy(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy detail'}
      </button>
      <pre>{JSON.stringify(event.detail ?? {}, null, 2)}</pre>
    </aside>
  );
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}
