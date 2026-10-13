import {deepStrictEqual} from 'node:assert';
import {
  type DecodedTarget,
  type LabelFormatterHost,
  registerAuthorityLabel,
  type ResourceLabelFormatter,
} from '../../src/index.ts';

const SSH_ALIAS: DecodedTarget = {
  family: 'ssh-remote',
  target: {kind: 'plain', text: 'my-alias:22'},
  rawHostString: 'my-alias:22',
};

/** A host that keeps the formatters it is given and hands back a disposable it can count. */
function recordingHost(): {
  host: LabelFormatterHost;
  formatters: ResourceLabelFormatter[];
  disposed: string[];
} {
  const formatters: ResourceLabelFormatter[] = [];
  const disposed: string[] = [];
  return {
    formatters,
    disposed,
    host: {
      registerResourceLabelFormatter: formatter => {
        formatters.push(formatter);
        return {
          dispose: () => {
            disposed.push(formatter.authority);
          },
        };
      },
    },
  };
}

describe('the label formatter of a window (F-2502.BR-2)', () => {
  it('F-2502.BR-2: it applies to the remote scheme and to the exact authority the window carries', () => {
    const {host, formatters} = recordingHost();
    registerAuthorityLabel(host, SSH_ALIAS, 'SSH: my-alias');
    deepStrictEqual(
      formatters.map(formatter => [formatter.scheme, formatter.authority]),
      [['vscode-remote', 'ssh-remote+my-alias:22']],
    );
  });

  it('F-2502.BR-2: an authority in the hex form is kept as written, not decoded', () => {
    const {host, formatters} = recordingHost();
    const hexForm: DecodedTarget = {
      family: 'ssh-remote',
      target: {kind: 'host', hostName: 'h', port: 2222},
      rawHostString: '7b22686f73744e616d65223a2268222c22706f7274223a323232327d',
    };
    registerAuthorityLabel(host, hexForm, 'SSH: h');
    deepStrictEqual(
      formatters.map(formatter => formatter.authority),
      ['ssh-remote+7b22686f73744e616d65223a2268222c22706f7274223a323232327d'],
    );
  });

  it('F-2502 AC-4: it writes paths with / and ~ for the home folder, the given suffix, and no tooltip (BR-2)', () => {
    const {host, formatters} = recordingHost();
    registerAuthorityLabel(host, SSH_ALIAS, 'SSH: my-alias');
    deepStrictEqual(
      formatters.map(formatter => formatter.formatting),
      [
        {
          label: '${path}',
          separator: '/',
          tildify: true,
          normalizeDriveLetter: true,
          workspaceSuffix: 'SSH: my-alias',
        },
      ],
    );
  });

  it('F-0501: a container authority gets the same formatter with its own suffix', () => {
    const {host, formatters} = recordingHost();
    const container: DecodedTarget = {
      family: 'dev-container',
      target: {payload: 'abcd'},
      rawHostString: 'abcd',
    };
    registerAuthorityLabel(host, container, 'Dev Container: abcd');
    deepStrictEqual(
      formatters.map(formatter => [
        formatter.authority,
        formatter.formatting.workspaceSuffix,
      ]),
      [['dev-container+abcd', 'Dev Container: abcd']],
    );
  });

  it('F-2502.BR-2: the disposable is the one the editor gave', () => {
    const {host, disposed} = recordingHost();
    registerAuthorityLabel(host, SSH_ALIAS, 'SSH: my-alias').dispose();
    deepStrictEqual(disposed, ['ssh-remote+my-alias:22']);
  });

  it('F-2502.BR-2: it registers once for each call', () => {
    const {host, formatters} = recordingHost();
    registerAuthorityLabel(host, SSH_ALIAS, 'SSH: my-alias');
    deepStrictEqual(formatters.length, 1);
  });
});
