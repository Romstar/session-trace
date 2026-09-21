/**
 * Shared connection defaults for the hook and the ingest server.
 */

export const DEFAULT_PORT = 43127;
export const PORT_SCAN_LIMIT = 30;
export const AGENT_GRAPH_DIR = '.agent-graph';
export const CONNECTION_FILE = 'connection.json';
export const ERROR_LOG_FILE = 'hook-errors.log';
export const HOOK_MARKER = '--agent-graph-hook';
export const MAX_EVENTS_PER_SESSION = 2000;
export const MAX_DETAIL_CHARS = 100_000;
export const MAX_BODY_BYTES = 2_000_000;
