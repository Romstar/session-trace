/**
 * Merge Agent Graph hook entries into the workspace .cursor/hooks.json.
 * Existing hooks and matchers stay in place.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CURSOR_HOOK_NAMES } from './shared/events';
import { HOOK_MARKER } from './shared/paths';

interface HookFile {
  version?: number;
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function installHooks(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const hookScript = path.join(context.extensionPath, 'hooks', 'hook.js');
  if (!fs.existsSync(hookScript)) {
    void vscode.window.showErrorMessage('Agent Graph hook script is missing. Rebuild the extension.');
    return;
  }

  const filePath = path.join(folder.uri.fsPath, '.cursor', 'hooks.json');
  const current = readHookFile(filePath);
  if (!current) {
    void vscode.window.showErrorMessage('Could not read .cursor/hooks.json. Fix the JSON, then try again.');
    return;
  }

  const hooks = asRecord(current.data.hooks) ?? {};
  const command = `node ${quoteForShell(hookScript)} ${HOOK_MARKER}`;
  const entry = {
    command,
    timeout: 5,
    agentGraphHook: true,
  };

  for (const name of CURSOR_HOOK_NAMES) {
    const existing = hooks[name];
    if (existing !== undefined && !Array.isArray(existing)) {
      void vscode.window.showWarningMessage(`Skipped hook ${name} because it is not a list.`);
      continue;
    }
    const kept = (Array.isArray(existing) ? existing : []).filter((item) => !isOurEntry(item));
    hooks[name] = [...kept, entry];
  }

  current.data.version = typeof current.data.version === 'number' ? current.data.version : 1;
  current.data.hooks = hooks;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(current.data, null, 2)}\n`);
  void vscode.window.showInformationMessage(
    'Agent hooks installed. Open the Agent Graph view, then run the Cursor agent.',
  );
}

export async function uninstallHooks(): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const filePath = path.join(folder.uri.fsPath, '.cursor', 'hooks.json');
  if (!fs.existsSync(filePath)) {
    void vscode.window.showInformationMessage('No .cursor/hooks.json file found.');
    return;
  }
  const current = readHookFile(filePath);
  if (!current) {
    void vscode.window.showErrorMessage('Could not read .cursor/hooks.json. Fix the JSON, then try again.');
    return;
  }
  const hooks = asRecord(current.data.hooks);
  if (!hooks) {
    void vscode.window.showInformationMessage('No Agent Graph hooks to remove.');
    return;
  }

  let removed = 0;
  for (const [name, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const kept = value.filter((item) => !isOurEntry(item));
    removed += value.length - kept.length;
    if (kept.length === 0) {
      delete hooks[name];
    } else {
      hooks[name] = kept;
    }
  }

  current.data.hooks = hooks;
  fs.writeFileSync(filePath, `${JSON.stringify(current.data, null, 2)}\n`);
  void vscode.window.showInformationMessage(
    removed > 0 ? 'Removed Agent Graph hooks.' : 'No Agent Graph hooks to remove.',
  );
}

function isOurEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const record = entry as Record<string, unknown>;
  if (record.agentGraphHook === true) {
    return true;
  }
  return typeof record.command === 'string' && record.command.includes(HOOK_MARKER);
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showErrorMessage('Open a folder before installing hooks.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick();
}

function readHookFile(filePath: string): { data: HookFile } | null {
  if (!fs.existsSync(filePath)) {
    return { data: { version: 1, hooks: {} } };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return { data: parsed as HookFile };
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function quoteForShell(filePath: string): string {
  if (process.platform === 'win32') {
    return `"${filePath.replace(/"/g, '\\"')}"`;
  }
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}
