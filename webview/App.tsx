import { useEffect, useMemo, useState } from 'react';
import { isHostMessage, type SessionSnapshot, type WebviewMessage } from '../src/shared/messages';
import { deriveState, eventsForSession, topLevelSessions, type DfaState } from '../src/shared/state';
import { DetailPanel } from './DetailPanel';
import { eventKey } from './layout';
import { GraphView } from './GraphView';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

interface SavedUi {
  followLive?: boolean;
  selectedKey?: string | null;
}

export function App() {
  const saved = readSaved();
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [followLive, setFollowLive] = useState(saved.followLive !== false);
  const [selectedKey, setSelectedKey] = useState<string | null>(saved.selectedKey ?? null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (!isHostMessage(message)) {
        return;
      }
      setSessions(message.sessions);
      setSelectedSessionId(message.selectedSessionId);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    vscode.setState({ followLive, selectedKey } satisfies SavedUi);
  }, [followLive, selectedKey]);

  const visibleSessions = useMemo(() => topLevelSessions(sessions), [sessions]);
  const events = useMemo(
    () => (selectedSessionId ? eventsForSession(sessions, selectedSessionId) : []),
    [sessions, selectedSessionId],
  );
  const state = deriveState(events);
  const selectedEvent = events.find((event) => eventKey(event) === selectedKey) ?? null;

  return (
    <div className="ag-app">
      <header className="ag-toolbar">
        <label className="ag-field">
          <span>Session</span>
          <select
            value={selectedSessionId ?? ''}
            onChange={(event) => {
              const sessionId = event.target.value;
              if (sessionId) {
                vscode.postMessage({ type: 'selectSession', sessionId });
              }
            }}
            disabled={visibleSessions.length === 0}
          >
            {visibleSessions.length === 0 ? <option value="">No sessions</option> : null}
            {visibleSessions.map((session) => (
              <option key={session.sessionId} value={session.sessionId} title={session.sessionId}>
                {sessionLabel(session)}
              </option>
            ))}
          </select>
        </label>
        <label className="ag-check">
          <input
            type="checkbox"
            checked={followLive}
            onChange={(event) => setFollowLive(event.target.checked)}
          />
          Follow live
        </label>
        <button
          type="button"
          className="ag-button ag-button-secondary"
          disabled={!selectedSessionId}
          onClick={() => {
            if (selectedSessionId) {
              setSelectedKey(null);
              vscode.postMessage({ type: 'clearSession', sessionId: selectedSessionId });
            }
          }}
        >
          Clear
        </button>
        <span className="ag-count">{events.length === 1 ? '1 event' : `${events.length} events`}</span>
        {state ? <StatusBadge state={state} /> : null}
      </header>
      <div className="ag-body">
        <div className="ag-canvas">
          {events.length === 0 ? (
            <div className="ag-empty">
              <h2>No agent events yet.</h2>
              <p>
                Run Install Agent Hooks from the command palette. Then open this view and start a Cursor
                agent. Each action shows up here as a node.
              </p>
            </div>
          ) : (
            <GraphView
              key={selectedSessionId ?? 'none'}
              events={events}
              followLive={followLive}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          )}
        </div>
        <DetailPanel
          event={selectedEvent}
          onCopy={(text) => vscode.postMessage({ type: 'copyDetail', text })}
        />
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: DfaState }) {
  return <span className={`ag-badge ag-badge-${state}`}>{state}</span>;
}

function sessionLabel(session: SessionSnapshot): string {
  const id = session.sessionId;
  const short = id.length > 22 ? `${id.slice(0, 10)}...${id.slice(-4)}` : id;
  return `${short} (${session.events.length})`;
}

function readSaved(): SavedUi {
  const value = vscode.getState();
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as SavedUi;
}
