/**
 * Local ingest server. Hooks POST AgentEvent JSON to /ingest.
 * Binds 127.0.0.1 only. Scans upward when the default port is in use.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { isAgentEvent } from './shared/events';
import type { SessionSnapshot } from './shared/messages';
import { SessionStore } from './sessionStore';
import {
  AGENT_GRAPH_DIR,
  CONNECTION_FILE,
  DEFAULT_PORT,
  MAX_BODY_BYTES,
  PORT_SCAN_LIMIT,
} from './shared/paths';

export interface ListenInfo {
  port: number;
  token: string;
}

export class IngestServer {
  private server: http.Server | undefined;
  private token = '';
  private followTimer: NodeJS.Timeout | undefined;
  private following = false;

  constructor(
    private readonly store: SessionStore,
    private readonly log: (line: string) => void,
  ) {}

  get isFollowing(): boolean {
    return this.following;
  }

  /**
   * Use an ingest server that is already running in another window.
   * Returns false when no compatible server is up, so the caller starts one.
   */
  async followExisting(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const connection = readConnection();
      if (connection) {
        const sessions = await fetchSessions(connection);
        if (sessions) {
          this.following = true;
          this.store.replace(sessions);
          this.followTimer = setInterval(() => {
            void this.poll();
          }, 500);
          this.log(`Following ingest server on 127.0.0.1:${connection.port}`);
          return true;
        }
      }
      await delay(200);
    }
    return false;
  }

  async clearRemote(sessionId: string | null): Promise<void> {
    const connection = readConnection();
    if (!connection) {
      return;
    }
    await requestJson(connection, 'POST', '/clear', JSON.stringify({ sessionId }));
  }

  async start(): Promise<ListenInfo> {
    this.token = crypto.randomBytes(24).toString('hex');
    const server = http.createServer((req, res) => this.handle(req, res));
    const port = await listenOnFreePort(server, DEFAULT_PORT, DEFAULT_PORT + PORT_SCAN_LIMIT);
    this.server = server;
    const info = { port, token: this.token };
    writeConnection(info);
    this.log(`Ingest server listening on 127.0.0.1:${port}`);
    return info;
  }

  dispose(): void {
    if (this.followTimer) {
      clearInterval(this.followTimer);
      this.followTimer = undefined;
    }
    this.server?.close();
    this.server = undefined;
  }

  private async poll(): Promise<void> {
    const connection = readConnection();
    if (!connection) {
      return;
    }
    const sessions = await fetchSessions(connection);
    if (sessions) {
      this.store.replace(sessions);
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && req.url === '/sessions') {
      if (!authorized(req, this.token)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      sendJson(res, 200, { sessions: this.store.snapshots() });
      return;
    }
    if (req.method === 'POST' && req.url === '/clear') {
      if (!authorized(req, this.token)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      readBody(req)
        .then((raw) => {
          const parsed = raw ? (JSON.parse(raw) as { sessionId?: unknown }) : {};
          const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
          this.store.clear(sessionId);
          sendJson(res, 200, { ok: true });
        })
        .catch(() => {
          sendJson(res, 400, { ok: false, error: 'bad request' });
        });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/ingest') {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    if (!authorized(req, this.token)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    readBody(req)
      .then((raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const incoming = SessionStore.parseIncoming(parsed);
        if (!incoming) {
          sendJson(res, 400, { ok: false, error: 'invalid event' });
          return;
        }
        const event = this.store.add(incoming);
        sendJson(res, 200, { ok: true, seq: event.seq });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'bad request';
        const status = message === 'too large' ? 413 : 400;
        sendJson(res, status, { ok: false, error: message });
      });
  }
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  if (!token) {
    return true;
  }
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return false;
  }
  const expected = `Bearer ${token}`;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(raw),
  });
  res.end(raw);
}

function listenOnFreePort(server: http.Server, start: number, end: number): Promise<number> {
  const tryPort = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListen);
        if (error.code === 'EADDRINUSE' && port < end) {
          resolve(tryPort(port + 1));
          return;
        }
        reject(error);
      };
      const onListen = () => {
        server.off('error', onError);
        resolve(port);
      };
      server.once('error', onError);
      server.once('listening', onListen);
      server.listen(port, '127.0.0.1');
    });
  return tryPort(start);
}

function readConnection(): ListenInfo | null {
  try {
    const file = path.join(os.homedir(), AGENT_GRAPH_DIR, CONNECTION_FILE);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: unknown; token?: unknown };
    if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string' || !parsed.token) {
      return null;
    }
    return { port: parsed.port, token: parsed.token };
  } catch {
    return null;
  }
}

async function fetchSessions(connection: ListenInfo): Promise<SessionSnapshot[] | null> {
  try {
    const response = await requestJson(connection, 'GET', '/sessions');
    if (response.status !== 200) {
      return null;
    }
    return parseSnapshots(JSON.parse(response.body));
  } catch {
    return null;
  }
}

function parseSnapshots(value: unknown): SessionSnapshot[] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const sessions = (value as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return null;
  }
  const parsed: SessionSnapshot[] = [];
  for (const item of sessions) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const sessionId = (item as { sessionId?: unknown }).sessionId;
    const events = (item as { events?: unknown }).events;
    if (typeof sessionId !== 'string' || !Array.isArray(events) || !events.every(isAgentEvent)) {
      return null;
    }
    parsed.push({ sessionId, events });
  }
  return parsed;
}

function requestJson(
  connection: ListenInfo,
  method: string,
  pathName: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      Authorization: `Bearer ${connection.token}`,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port: connection.port,
        path: pathName,
        method,
        headers,
        timeout: 400,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeConnection(info: ListenInfo): void {
  const dir = path.join(os.homedir(), AGENT_GRAPH_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, CONNECTION_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ port: info.port, token: info.token }, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}
