import {deepStrictEqual, strictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {
  type EditorApi,
  registerSshConfigCompletion,
} from '../../src/completion-adapter.ts';

interface Registration {
  language: string;
  triggers: string[];
  provider: vscode.CompletionItemProvider;
}

class FakeItem {
  label: string;
  kind: number;
  sortText?: string;
  documentation?: string;
  insertText?: FakeSnippet;

  constructor(label: string, kind: number) {
    this.label = label;
    this.kind = kind;
  }
}

class FakeSnippet {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

const PROPERTY = 9;
const SNIPPET = 27;
const DISPOSABLE = {dispose: () => undefined};

function fakeEditor(registrations: Registration[]): EditorApi {
  const fake = {
    languages: {
      registerCompletionItemProvider(
        language: string,
        provider: vscode.CompletionItemProvider,
        ...triggers: string[]
      ) {
        registrations.push({language, triggers, provider});
        return DISPOSABLE;
      },
    },
    CompletionItem: FakeItem,
    CompletionItemKind: {Property: PROPERTY, Snippet: SNIPPET},
    SnippetString: FakeSnippet,
    l10n: {t: (message: string) => `«${message}»`},
  };
  // The fake implements only the members the adapter calls.
  return fake as unknown as EditorApi;
}

function itemsAt(provider: vscode.CompletionItemProvider, line: string) {
  const document = {lineAt: () => ({text: line})};
  const position = {line: 0, character: line.length};
  // The provider reads only lineAt(...).text and the position's line and character.
  return provider.provideCompletionItems(
    document as unknown as vscode.TextDocument,
    position as vscode.Position,
    undefined as unknown as vscode.CancellationToken,
    undefined as unknown as vscode.CompletionContext,
  ) as FakeItem[] | undefined;
}

describe('completion adapter', () => {
  let registrations: Registration[];
  let provider: vscode.CompletionItemProvider;

  beforeEach(() => {
    registrations = [];
    strictEqual(
      registerSshConfigCompletion(fakeEditor(registrations)),
      DISPOSABLE,
    );
    const [registration] = registrations;
    if (registration === undefined) {
      throw new Error('the adapter registers one provider');
    }
    provider = registration.provider;
  });

  it('registers one provider for ssh_config with the space as its only trigger', () => {
    deepStrictEqual(
      registrations.map(({language, triggers}) => ({language, triggers})),
      [{language: 'ssh_config', triggers: [' ']}],
    );
  });

  it('returns nothing after the first word', () => {
    strictEqual(itemsAt(provider, 'HostName '), undefined);
  });

  it('returns the 95 keyword items as properties at a keyword position', () => {
    deepStrictEqual(
      itemsAt(provider, 'Ho')
        ?.filter(item => item.kind === PROPERTY)
        .map(item => item.label).length,
      95,
    );
  });

  it('localizes the snippet and gives it the tunnel template', () => {
    const snippet = itemsAt(provider, '')?.find(item => item.kind === SNIPPET);
    deepStrictEqual(
      [
        snippet?.label,
        snippet?.documentation,
        snippet?.sortText,
        snippet?.insertText?.value.split('\n')[0],
      ],
      [
        '«Configure tunnel»',
        '«Insert a template for configuring a tunnel connection.»',
        '«configure tunnel»',
        'Host ${1:alias}',
      ],
    );
  });

  it('gives keyword items plain-text documentation and no insert text', () => {
    const item = itemsAt(provider, '')?.find(entry => entry.label === 'Port');
    deepStrictEqual(
      [item?.sortText, item?.documentation?.split('.')[0], item?.insertText],
      [
        'port',
        'Specifies the port number to connect on the remote host',
        undefined,
      ],
    );
  });
});
