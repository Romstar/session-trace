/**
 * Cursor hook entry.
 * Cursor sends one JSON payload on stdin and expects {"continue": true} on stdout.
 * The HTTP post is fire-and-forget. This file has no npm dependencies.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { mapHookPayload } from './mapEvent';
import {
  AGENT_GRAPH_DIR,
  CONNECTION_FILE,
  DEFAULT_PORT,
  ERROR_LOG_FILE,
} from '../shared/paths';

const POST_TIMEOUT_MS = 500;

let responded = false;

function logError(error: unknown): void {
  try {
    const dir = path.join(os.homedir(), AGENT_GRAPH_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()} ${errorText(error)}\n`;
    fs.appendFileSync(path.join(dir, ERROR_LOG_FILE), line);
  } catch {
    // Logging must not change the hook result.
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function respond(): void {
  if (responded) {
    return;
  }
  responded = true;
  try {
    process.stdout.write('{"continue":true}\n');
  } catch (error) {
    logError(error);
  }
}

interface Connection {
  port: number;
  token: string;
}

function readConnection(): Connection {
  try {
    const file = path.join(os.homedir(), AGENT_GRAPH_DIR, CONNECTION_FILE);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: unknown; token?: unknown };
    const port = typeof parsed.port === 'number' && parsed.port > 0 ? parsed.port : DEFAULT_PORT;
    const token = typeof parsed.token === 'string' ? parsed.token : '';
    return { port, token };
  } catch {
    return { port: DEFAULT_PORT, token: '' };
  }
}

function postEvent(body: string): void {
  let connection: Connection;
  try {
    connection = readConnection();
  } catch (error) {
    logError(error);
    return;
  }

  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (connection.token) {
    headers.Authorization = `Bearer ${connection.token}`;
  }

  let settled = false;
  const finish = (): void => {
    if (settled) {
      return;
    }
    settled = true;
  };

  try {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: connection.port,
        path: '/ingest',
        method: 'POST',
        headers,
        timeout: POST_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          logError(`ingest status ${status}`);
        }
        res.resume();
        res.on('end', finish);
        res.on('error', (error) => {
          logError(error);
          finish();
        });
      },
    );
    req.setTimeout(POST_TIMEOUT_MS, () => {
      req.destroy();
    });
    req.on('error', (error) => {
      logError(error);
      finish();
    });
    req.on('close', finish);
    req.write(body);
    req.end();
  } catch (error) {
    logError(error);
  }
}

function handleStdin(raw: string): void {
  // Print the protocol response before any network work.
  respond();
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logError('hook payload is not an object');
      return;
    }
    const event = mapHookPayload(parsed as Record<string, unknown>);
    if (!event) {
      return;
    }
    postEvent(JSON.stringify(event));
  } catch (error) {
    logError(error);
  }
}

process.on('uncaughtException', (error) => {
  logError(error);
  respond();
});

const chunks: Buffer[] = [];
process.stdin.on('data', (chunk: Buffer | string) => {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
});
process.stdin.on('error', (error) => {
  logError(error);
  respond();
});
process.stdin.on('end', () => {
  try {
    handleStdin(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    logError(error);
    respond();
  }
});
