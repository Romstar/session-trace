/**
 * Agent Graph extension host.
 * Starts the ingest server on activate so hooks can post before the view opens.
 */

import * as vscode from 'vscode';
import { IngestServer } from './ingestServer';
import { installHooks, uninstallHooks } from './hookConfig';
import { SessionStore } from './sessionStore';
import { AgentGraphViewProvider } from './viewProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Agent Graph');
  const store = new SessionStore();
  const server = new IngestServer(store, (line) => output.appendLine(line));
  const provider = new AgentGraphViewProvider(context, store);

  const unsubscribe = store.onChange(() => provider.refresh());
  context.subscriptions.push(output);
  context.subscriptions.push({ dispose: () => server.dispose() });
  context.subscriptions.push({ dispose: unsubscribe });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgentGraphViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  try {
    const followed = await server.followExisting();
    if (!followed) {
      await server.start();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Ingest server failed: ${message}`);
    void vscode.window.showErrorMessage(`Agent Graph failed to start the ingest server. ${message}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-graph.openWindow', () => provider.openInNewWindow()),
    vscode.commands.registerCommand('agent-graph.installHooks', () => installHooks(context)),
    vscode.commands.registerCommand('agent-graph.uninstallHooks', () => uninstallHooks()),
    vscode.commands.registerCommand('agent-graph.clearSession', async () => {
      const selected = provider.selectedSessionIdValue;
      if (server.isFollowing) {
        await server.clearRemote(selected);
      } else {
        store.clear(selected);
      }
      void vscode.window.showInformationMessage(
        selected ? `Cleared session ${selected}.` : 'Cleared all agent graph sessions.',
      );
    }),
  );
}

export function deactivate(): void {
  // Disposables close the server.
}
