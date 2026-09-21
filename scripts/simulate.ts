/**
 * Post a fake agent session to the ingest server.
 * Use this to demo the graph without a live Cursor agent.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AgentEvent, EventType } from '../src/shared/events';
import { AGENT_GRAPH_DIR, CONNECTION_FILE, DEFAULT_PORT } from '../src/shared/paths';

interface Draft {
  type: EventType;
  label: string;
  detail?: Record<string, unknown>;
}

const sessionId = `sim-${Date.now()}`;

const drafts: Draft[] = [
  {
    type: 'session_start',
    label: 'session started (agent)',
    detail: { source: 'simulator', composer_mode: 'agent' },
  },
  {
    type: 'prompt_submit',
    label: 'prompt: fix the failing parser test',
    detail: {
      prompt: 'The parser test fails on an empty header. Find the bug, fix it, and rerun npm test.',
    },
  },
  {
    type: 'thought',
    label: 'thought: the failure is in parseHeader',
    detail: {
      text: 'The stack trace points at parseHeader. I will read the parser, the test, and then patch the null check.',
    },
  },
  {
    type: 'tool_start',
    label: 'read src/parser.ts',
    detail: {
      toolName: 'Read',
      toolUseId: 'tool-1',
      toolInput: { path: 'src/parser.ts' },
    },
  },
  {
    type: 'tool_end',
    label: 'read src/parser.ts',
    detail: {
      toolName: 'Read',
      toolUseId: 'tool-1',
      toolOutput: 'export function parseHeader(input) { return input.split(":")[0]; }',
    },
  },
  {
    type: 'tool_start',
    label: 'grep parseHeader',
    detail: {
      toolName: 'Grep',
      toolUseId: 'tool-2',
      toolInput: { pattern: 'parseHeader' },
    },
  },
  {
    type: 'tool_end',
    label: 'grep parseHeader',
    detail: {
      toolName: 'Grep',
      toolUseId: 'tool-2',
      toolOutput: 'src/parser.ts:12\nsrc/parser.test.ts:8',
    },
  },
  {
    type: 'tool_start',
    label: 'task explore the parser test',
    detail: {
      toolName: 'Task',
      toolUseId: 'tool-3',
      toolInput: { description: 'Read the failing test and report the expected header shape.' },
    },
  },
  {
    type: 'subagent_start',
    label: 'subagent explore: read the failing test',
    detail: {
      subagentId: 'sub-1',
      subagentType: 'explore',
      toolCallId: 'tool-3',
      task: 'Read the failing test and report the expected header shape.',
    },
  },
  {
    type: 'thought',
    label: 'thought: the test expects a null header',
    detail: {
      subagentId: 'sub-1',
      text: 'The test calls parseHeader(null) and expects an empty string.',
    },
  },
  {
    type: 'tool_start',
    label: 'read src/parser.test.ts',
    detail: {
      subagentId: 'sub-1',
      toolName: 'Read',
      toolUseId: 'tool-3a',
      toolInput: { path: 'src/parser.test.ts' },
    },
  },
  {
    type: 'tool_end',
    label: 'read src/parser.test.ts',
    detail: {
      subagentId: 'sub-1',
      toolName: 'Read',
      toolUseId: 'tool-3a',
      toolOutput: 'expect(parseHeader(null)).toBe("");',
    },
  },
  {
    type: 'subagent_stop',
    label: 'subagent explore completed',
    detail: {
      subagentId: 'sub-1',
      toolCallId: 'tool-3',
      status: 'completed',
      summary: 'parseHeader must return an empty string when the input is null.',
    },
  },
  {
    type: 'tool_end',
    label: 'task explore the parser test',
    detail: {
      toolName: 'Task',
      toolUseId: 'tool-3',
      toolOutput: 'parseHeader must return an empty string when the input is null.',
    },
  },
  {
    type: 'file_edit',
    label: 'edit src/parser.ts',
    detail: {
      filePath: 'src/parser.ts',
      edits: [
        {
          old_string: 'return input.split(":")[0];',
          new_string: 'if (!input) return "";\n  return input.split(":")[0];',
        },
      ],
    },
  },
  {
    type: 'shell_start',
    label: 'run npm test',
    detail: { command: 'npm test', toolUseId: 'shell-1' },
  },
  {
    type: 'shell_end',
    label: 'ran npm test (exit 1)',
    detail: {
      command: 'npm test',
      toolUseId: 'shell-1',
      exitCode: 1,
      output: 'FAIL src/parser.test.ts\nTypeError: Cannot read properties of null',
    },
  },
  {
    type: 'error',
    label: 'error: npm test failed (exit 1)',
    detail: {
      failureType: 'error',
      errorMessage: 'npm test exited 1. parseHeader still throws on null.',
      exitCode: 1,
    },
  },
  {
    type: 'thought',
    label: 'thought: retry with a stricter null check',
    detail: {
      text: 'The first edit did not guard the split call. I will return early when input is null, then run the test again.',
    },
  },
  {
    type: 'file_edit',
    label: 'edit src/parser.ts',
    detail: {
      filePath: 'src/parser.ts',
      edits: [
        {
          old_string: 'export function parseHeader(input) {',
          new_string: 'export function parseHeader(input) {\n  if (input == null) return "";',
        },
      ],
    },
  },
  {
    type: 'shell_start',
    label: 'run npm test',
    detail: { command: 'npm test', toolUseId: 'shell-2' },
  },
  {
    type: 'shell_end',
    label: 'ran npm test (exit 0)',
    detail: {
      command: 'npm test',
      toolUseId: 'shell-2',
      exitCode: 0,
      output: 'PASS src/parser.test.ts',
    },
  },
  {
    type: 'agent_response',
    label: 'response: fixed the null check in parseHeader',
    detail: {
      text: 'parseHeader now returns an empty string for null input. npm test passes.',
    },
  },
  {
    type: 'stop',
    label: 'stop (completed)',
    detail: { status: 'completed' },
  },
  {
    type: 'session_end',
    label: 'session ended (completed)',
    detail: { reason: 'completed' },
  },
];

async function main(): Promise<void> {
  const connection = readConnection();
  const health = await request(connection, 'GET', '/health', '');
  if (health.status !== 200) {
    throw new Error(
      'Ingest server is not running. Start the Agent Graph extension, then run this script again.',
    );
  }

  let seqSeen = 0;
  for (const draft of drafts) {
    const event: AgentEvent = {
      sessionId,
      seq: 0,
      ts: Date.now(),
      type: draft.type,
      label: draft.label,
      detail: draft.detail,
    };
    const result = await request(connection, 'POST', '/ingest', JSON.stringify(event));
    if (result.status !== 200) {
      throw new Error(`Ingest rejected ${draft.type} with status ${result.status}: ${result.body}`);
    }
    seqSeen += 1;
    await delay(40);
  }

  process.stdout.write(`Posted ${seqSeen} events for session ${sessionId} on port ${connection.port}.\n`);
}

function readConnection(): { port: number; token: string } {
  const file = path.join(os.homedir(), AGENT_GRAPH_DIR, CONNECTION_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: unknown; token?: unknown };
    return {
      port: typeof parsed.port === 'number' ? parsed.port : DEFAULT_PORT,
      token: typeof parsed.token === 'string' ? parsed.token : '',
    };
  } catch {
    return { port: DEFAULT_PORT, token: '' };
  }
}

function request(
  connection: { port: number; token: string },
  method: string,
  pathName: string,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (connection.token) {
      headers.Authorization = `Bearer ${connection.token}`;
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port: connection.port,
        path: pathName,
        method,
        headers,
        timeout: 2000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (error) => {
      if (method === 'GET') {
        resolve({ status: 0, body: error.message });
        return;
      }
      reject(error);
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
