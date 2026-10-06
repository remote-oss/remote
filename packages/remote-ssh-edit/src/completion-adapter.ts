/**
 * @fileoverview The one adapter between the completion data and the editor: it registers the provider for
 * `ssh_config` with the space as its only trigger character and nothing else.
 */

import type * as vscode from 'vscode';
import {completionEntries, isKeywordPosition} from './completion.ts';
import {languages} from './identifiers.generated.ts';

/** The part of the editor API the adapter uses; the extension passes the real `vscode` module. */
export type EditorApi = Pick<
  typeof vscode,
  | 'languages'
  | 'CompletionItem'
  | 'CompletionItemKind'
  | 'SnippetString'
  | 'l10n'
>;

function toItem(
  editor: EditorApi,
  entry: ReturnType<typeof completionEntries>[number],
): vscode.CompletionItem {
  const kind =
    entry.kind === 'snippet'
      ? editor.CompletionItemKind.Snippet
      : editor.CompletionItemKind.Property;
  const item = new editor.CompletionItem(entry.label, kind);
  item.sortText = entry.sortText;
  item.documentation = entry.documentation;
  if (entry.snippet !== undefined) {
    item.insertText = new editor.SnippetString(entry.snippet);
  }
  return item;
}

/**
 * Registers the completion provider for SSH configuration files: the 96 items at a keyword position, nothing
 * elsewhere. Returns the registration to dispose.
 */
export function registerSshConfigCompletion(
  editor: EditorApi,
): vscode.Disposable {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      const textBeforeCursor = document
        .lineAt(position.line)
        .text.slice(0, position.character);
      if (!isKeywordPosition(textBeforeCursor)) {
        return undefined;
      }
      const snippet = {
        label: editor.l10n.t('Configure tunnel'),
        documentation: editor.l10n.t(
          'Insert a template for configuring a tunnel connection.',
        ),
      };
      return completionEntries(snippet).map(entry => toItem(editor, entry));
    },
  };
  return editor.languages.registerCompletionItemProvider(
    languages.sshConfig,
    provider,
    ' ',
  );
}
