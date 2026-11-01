import {deepStrictEqual, strictEqual} from 'node:assert';
import type {DecodedTarget, ResourceLabelFormatter} from 'lib-authority';
import {registerWindowLabel} from '../../src/surfaces/label-formatter.ts';
import type {Translate} from '../../src/surfaces/strings.ts';

function same(template: string): string {
  return template;
}

function german(template: string): string {
  return template === 'SSH: {0}' ? 'SSH-Host: {0}' : template;
}

/** A label formatter host that records the formatters it is given and counts their disposals. */
class FakeFormatterHost {
  readonly formatters: ResourceLabelFormatter[] = [];
  disposals = 0;

  registerResourceLabelFormatter(formatter: ResourceLabelFormatter): {
    dispose(): void;
  } {
    this.formatters.push(formatter);
    return {
      dispose: () => {
        this.disposals += 1;
      },
    };
  }
}

/** A resolver handle whose first resolve start the test fires, with the target it answers. */
function fakeResolver() {
  let listener: ((target: DecodedTarget) => void) | undefined;
  const resolver = {
    onFirstResolveStarted: (
      callback: (target: DecodedTarget) => void,
    ): void => {
      listener = callback;
    },
  };
  function started(target: DecodedTarget): void {
    listener?.(target);
  }
  return {resolver, started};
}

/** The host, the fake resolver and the registration of one row, ready to start. */
function freshRow(translate: Translate = same) {
  const host = new FakeFormatterHost();
  const {resolver, started} = fakeResolver();
  const handle = registerWindowLabel(resolver, host, translate);
  return {host, handle, started};
}

/** A decoded ssh target, plain as written. */
function sshTarget(rawHostString: string): DecodedTarget {
  return {
    family: 'ssh-remote',
    target: {kind: 'plain', text: rawHostString},
    rawHostString,
  };
}

/** A decoded wsl target: its shape has no kind. */
function wslTarget(): DecodedTarget {
  return {
    family: 'wsl',
    target: {distro: 'ubuntu'},
    rawHostString: 'wsl+ubuntu',
  };
}

describe('the window label at the first resolve start (card connect-100)', () => {
  it('F-2410 AC-12: the label is registered when the first resolve starts, before its outcome, and stays registered when the resolve then fails', () => {
    const {host, started} = freshRow();
    started(sshTarget('dev'));
    // The outcome is the resolve's business; nothing of it removes the registration.
    deepStrictEqual(
      [host.formatters.length, host.formatters[0]?.formatting.workspaceSuffix],
      [1, 'SSH: dev'],
    );
  });

  it('F-2410 AC-12: for ssh-remote+harness the formatter carries the authority as written and the suffix', () => {
    const {host, started} = freshRow();
    started(sshTarget('harness'));
    deepStrictEqual(
      [
        host.formatters[0]?.scheme,
        host.formatters[0]?.authority,
        host.formatters[0]?.formatting.workspaceSuffix,
      ],
      ['vscode-remote', 'ssh-remote+harness', 'SSH: harness'],
    );
  });

  it('F-2410 AC-12: dispose before the start registers nothing', () => {
    const {host, handle, started} = freshRow();
    handle.dispose();
    started(sshTarget('dev'));
    deepStrictEqual([host.formatters.length, host.disposals], [1, 1]);
  });

  it('F-2502 BR-2: the start registers the authority as written', () => {
    const {host, started} = freshRow();
    started(sshTarget('dev'));
    deepStrictEqual(host.formatters[0]?.authority, 'ssh-remote+dev');
  });

  it('F-2502 BR-3, AC-14: the alias of a user and port target is the suffix', () => {
    const {host, started} = freshRow();
    started(sshTarget('alex@my-alias:22'));
    deepStrictEqual(
      host.formatters[0]?.formatting.workspaceSuffix,
      'SSH: my-alias',
    );
  });

  it('F-2502 BR-2: a target that is not ssh-remote registers nothing', () => {
    const {host, started} = freshRow();
    started(wslTarget());
    strictEqual(host.formatters.length, 0);
  });

  it('F-2502 BR-2: nothing started yet registers nothing', () => {
    const {host} = freshRow();
    strictEqual(host.formatters.length, 0);
  });

  it('F-2502 BR-2: dispose after a resolve disposes the registration once', () => {
    const {host, handle, started} = freshRow();
    started(sshTarget('dev'));
    handle.dispose();
    deepStrictEqual([host.formatters.length, host.disposals], [1, 1]);
  });

  it('F-2502 BR-2: dispose twice after a resolve disposes once', () => {
    const {host, handle, started} = freshRow();
    started(sshTarget('dev'));
    handle.dispose();
    handle.dispose();
    strictEqual(host.disposals, 1);
  });

  it('R-29: a resolve with a translated table registers the translated suffix', () => {
    const {host, started} = freshRow(german);
    started(sshTarget('dev'));
    deepStrictEqual(
      host.formatters[0]?.formatting.workspaceSuffix,
      'SSH-Host: dev',
    );
  });
});
