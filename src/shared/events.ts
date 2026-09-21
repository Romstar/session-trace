/**
 * Shared event contract.
 * Every producer emits this shape. The ingestor assigns seq.
 */

export const EVENT_TYPES = [
  'session_start',
  'session_end',
  'thought',
  'tool_start',
  'tool_end',
  'shell_start',
  'shell_end',
  'file_read',
  'file_edit',
  'mcp_start',
  'mcp_end',
  'prompt_submit',
  'agent_response',
  'subagent_start',
  'subagent_stop',
  'compact',
  'stop',
  'error',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface AgentEvent {
  sessionId: string;
  seq: number;
  ts: number;
  type: EventType;
  /** Short human line, for example "read src/index.ts". */
  label: string;
  /** Full payload: tool input, tool output, thought text, exit codes. */
  detail?: Record<string, unknown>;
}

/** Cursor hook name -> AgentEvent type. One entry per hook the extension installs. */
export const HOOK_EVENT_MAP = {
  sessionStart: 'session_start',
  sessionEnd: 'session_end',
  preToolUse: 'tool_start',
  postToolUse: 'tool_end',
  postToolUseFailure: 'error',
  beforeShellExecution: 'shell_start',
  afterShellExecution: 'shell_end',
  beforeReadFile: 'file_read',
  afterFileEdit: 'file_edit',
  beforeMCPExecution: 'mcp_start',
  afterMCPExecution: 'mcp_end',
  beforeSubmitPrompt: 'prompt_submit',
  afterAgentThought: 'thought',
  afterAgentResponse: 'agent_response',
  subagentStart: 'subagent_start',
  subagentStop: 'subagent_stop',
  preCompact: 'compact',
  stop: 'stop',
} as const satisfies Record<string, EventType>;

export type CursorHookName = keyof typeof HOOK_EVENT_MAP;

export const CURSOR_HOOK_NAMES = Object.keys(HOOK_EVENT_MAP) as CursorHookName[];

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === 'string' &&
    record.sessionId.length > 0 &&
    typeof record.seq === 'number' &&
    typeof record.ts === 'number' &&
    isEventType(record.type) &&
    typeof record.label === 'string' &&
    (record.detail === undefined || (!!record.detail && typeof record.detail === 'object'))
  );
}
