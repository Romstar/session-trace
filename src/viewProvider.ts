/**
 * Sidebar webview. Receives session snapshots and posts them to the graph UI.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { isWebviewMessage, type HostMessage, type SessionSnapshot } from './shared/messages';
import { topLevelSessions } from './shared/state';
import type { SessionStore } from './sessionStore';

export class AgentGraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'agent-graph.view';

  private view: vscode.WebviewView | undefined;
  private selectedSessionId: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: SessionStore,
  ) {}

  get selectedSessionIdValue(): string | null {
    return this.selectedSessionId;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    view.webview.onDidReceiveMessage((message: unknown) => this.onMessage(message));
    view.webview.html = this.html(view.webview);
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  refresh(): void {
    this.postSnapshot();
  }

  private onMessage(message: unknown): void {
    if (!isWebviewMessage(message)) {
      return;
    }
    switch (message.type) {
      case 'ready':
        this.postSnapshot();
        return;
      case 'selectSession':
        this.selectedSessionId = message.sessionId;
        this.postSnapshot();
        return;
      case 'clearSession':
        if (!message.sessionId || message.sessionId === this.selectedSessionId) {
          this.selectedSessionId = null;
        }
        this.store.clear(message.sessionId);
        return;
      case 'copyDetail':
        void vscode.env.clipboard.writeText(message.text);
        return;
      default:
        return;
    }
  }

  private postSnapshot(): void {
    const sessions = this.store.snapshots();
    this.selectedSessionId = keepSelection(sessions, this.selectedSessionId);
    const message: HostMessage = {
      type: 'snapshot',
      sessions,
      selectedSessionId: this.selectedSessionId,
    };
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Agent Graph</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function keepSelection(sessions: SessionSnapshot[], selected: string | null): string | null {
  const top = topLevelSessions(sessions);
  if (selected && top.some((session) => session.sessionId === selected)) {
    return selected;
  }
  if (top.length === 0) {
    return null;
  }
  return top[top.length - 1].sessionId;
}
