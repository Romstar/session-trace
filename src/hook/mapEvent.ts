/**
 * Map one Cursor hook payload to an AgentEvent.
 * seq stays 0. The ingest server assigns the real seq.
 */

import { HOOK_EVENT_MAP, type AgentEvent, type EventType } from '../shared/events';

const LABEL_MAX = 72;

export function mapHookPayload(payload: Record<string, unknown>): AgentEvent | null {
  const hookName = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';
  const type = HOOK_EVENT_MAP[hookName as keyof typeof HOOK_EVENT_MAP];
  if (!type) {
    return null;
  }

  const sessionId = readSessionId(payload);
  const detail = buildDetail(payload, type);

  return {
    sessionId,
    seq: 0,
    ts: Date.now(),
    type,
    label: buildLabel(type, payload),
    detail,
  };
}

function readSessionId(payload: Record<string, unknown>): string {
  const conversation = payload.conversation_id;
  if (typeof conversation === 'string' && conversation.trim()) {
    return conversation;
  }
  const session = payload.session_id;
  if (typeof session === 'string' && session.trim()) {
    return session;
  }
  return 'unknown-session';
}

function buildLabel(type: EventType, payload: Record<string, unknown>): string {
  switch (type) {
    case 'session_start': {
      const mode = typeof payload.composer_mode === 'string' ? payload.composer_mode : '';
      return mode ? `session started (${mode})` : 'session started';
    }
    case 'session_end': {
      const reason = typeof payload.reason === 'string' ? payload.reason : 'ended';
      return `session ended (${reason})`;
    }
    case 'thought':
      return `thought: ${clip(payload.text, 60)}`;
    case 'agent_response':
      return `response: ${clip(payload.text, 60)}`;
    case 'prompt_submit':
      return `prompt: ${clip(payload.prompt, 60)}`;
    case 'tool_start':
      return toolLabel(payload, false);
    case 'tool_end':
      return toolLabel(payload, true);
    case 'error':
      return `error: ${clip(payload.tool_name ?? 'tool', 24)} ${clip(payload.error_message, 40)}`.trim();
    case 'shell_start':
      return `run ${clip(payload.command, 60)}`;
    case 'shell_end': {
      const command = clip(payload.command, 48);
      const code = readExitCode(payload);
      return code === undefined ? `ran ${command}` : `ran ${command} (exit ${code})`;
    }
    case 'file_read':
      return `read ${shortPath(payload.file_path, payload.workspace_roots)}`;
    case 'file_edit':
      return `edit ${shortPath(payload.file_path, payload.workspace_roots)}`;
    case 'mcp_start':
      return `mcp ${mcpName(payload)}`;
    case 'mcp_end':
      return `mcp ${mcpName(payload)} done`;
    case 'subagent_start':
      return `subagent ${clip(payload.subagent_type, 20)}: ${clip(payload.task, 40)}`;
    case 'subagent_stop':
      return `subagent ${clip(payload.subagent_type, 20)} ${clip(payload.status, 16)}`;
    case 'compact': {
      const percent = payload.context_usage_percent;
      return typeof percent === 'number' ? `compact context (${percent}%)` : 'compact context';
    }
    case 'stop':
      return `stop (${clip(payload.status ?? 'completed', 20)})`;
    default:
      return type;
  }
}

function toolLabel(payload: Record<string, unknown>, finished: boolean): string {
  const name = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool';
  const input = asRecord(payload.tool_input);
  const command = input?.command ?? payload.command;
  if (typeof command === 'string' && command.trim()) {
    return finished ? `ran ${clip(command, 60)}` : `run ${clip(command, 60)}`;
  }
  const target =
    input?.path ??
    input?.file_path ??
    input?.target_file ??
    input?.pattern ??
    input?.query ??
    payload.file_path;
  const verb = name.toLowerCase();
  if (typeof target === 'string' && target.trim()) {
    return `${verb} ${shortPath(target, payload.workspace_roots)}`;
  }
  return finished ? `${verb} done` : verb;
}

function mcpName(payload: Record<string, unknown>): string {
  const server = typeof payload.mcp_server_name === 'string' ? payload.mcp_server_name : 'mcp';
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool';
  return clip(`${server}.${tool}`, 60);
}

function buildDetail(payload: Record<string, unknown>, type: EventType): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  const input = asRecord(payload.tool_input);

  copyField(detail, 'toolName', payload.tool_name);
  if (input) {
    detail.toolInput = shrink(input);
  } else if (payload.tool_input !== undefined) {
    detail.toolInput = shrink(payload.tool_input);
  }
  if (payload.tool_output !== undefined) {
    detail.toolOutput = shrink(parseMaybeJson(payload.tool_output));
  }
  copyField(detail, 'command', payload.command);
  copyField(detail, 'text', shrink(payload.text));
  copyField(detail, 'prompt', shrink(payload.prompt));
  copyField(detail, 'filePath', payload.file_path);
  copyField(detail, 'errorMessage', payload.error_message);
  copyField(detail, 'failureType', payload.failure_type);
  copyField(detail, 'subagentId', payload.subagent_id);
  copyField(detail, 'subagentType', payload.subagent_type);
  copyField(detail, 'toolUseId', payload.tool_use_id);
  copyField(detail, 'toolCallId', payload.tool_call_id);
  copyField(detail, 'mcpServer', payload.mcp_server_name);
  copyField(detail, 'status', payload.status ?? payload.reason);
  copyField(detail, 'durationMs', payload.duration ?? payload.duration_ms);

  const exitCode = readExitCode(payload);
  if (exitCode !== undefined) {
    detail.exitCode = exitCode;
  }

  if (typeof payload.parent_conversation_id === 'string') {
    detail.parentSessionId = payload.parent_conversation_id;
  }

  if (payload.edits !== undefined) {
    detail.edits = shrink(payload.edits);
  }
  if (payload.output !== undefined) {
    detail.output = shrink(payload.output);
  }
  if (payload.result_json !== undefined) {
    detail.result = shrink(parseMaybeJson(payload.result_json));
  }
  if (type === 'file_read' && payload.content !== undefined) {
    detail.content = shrink(payload.content);
  }

  // Keep the original payload so the detail panel can show every field.
  detail.payload = shrink(payload);
  return detail;
}

function copyField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

function readExitCode(payload: Record<string, unknown>): number | undefined {
  for (const key of ['exit_code', 'exitCode', 'exit']) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function shortPath(filePath: unknown, roots: unknown): string {
  let text = String(filePath ?? '').replace(/\\/g, '/');
  if (!text) {
    return 'file';
  }
  const list = Array.isArray(roots) ? roots : [];
  for (const root of list) {
    const prefix = String(root).replace(/\\/g, '/').replace(/\/$/, '');
    if (prefix && (text === prefix || text.startsWith(`${prefix}/`))) {
      text = text.slice(prefix.length).replace(/^\//, '');
      break;
    }
  }
  if (!text.includes('/')) {
    return clip(text, 60);
  }
  const parts = text.split('/').filter(Boolean);
  return clip(parts.slice(-3).join('/'), 60);
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

const STRING_CAP = 12_000;

/** Clip huge strings so one file read cannot stall the ingest server. */
export function shrink(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (value.length <= STRING_CAP) {
      return value;
    }
    return `${value.slice(0, STRING_CAP)} [truncated]`;
  }
  if (depth > 6) {
    return '[nested]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => shrink(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
    for (const [key, item] of entries) {
      output[key] = shrink(item, depth + 1);
    }
    return output;
  }
  return value;
}

export function clipLabel(text: string): string {
  return clip(text, LABEL_MAX);
}
