import {deepStrictEqual} from 'node:assert';
import {createLogger, type LogLine} from 'lib-log';
import {
  PENDING_COMMANDS,
  pendingHandlers,
} from '../../src/commands/pending-handlers.ts';
import {RUNTIME_COMMAND_IDS} from '../../src/commands/runtime-commands.ts';
import {
  REJECTED_IN_WEB,
  registerWebResolver,
  webHandlers,
  webRuntimeHandler,
} from '../../src/web-activation.ts';

const MESSAGE = 'Local hostAuthority resolutions are not possible in web';
const REFUSAL = 'WSL on the web requires an exec server.';

/** The message `action` throws, or `returned` when it returns. */
function thrownBy(action: () => unknown): string {
  try {
    action();
    return 'returned';
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

function loggerInto(lines: string[]) {
  return createLogger(
    {
      write: (line: LogLine) => {
        lines.push(line.message);
      },
    },
    {minimumLevel: () => 'trace'},
  );
}

describe('WSL in the browser (wsl.web-entry)', () => {
  it('each command that would open a WSL window rejects with the message the editor shows, translated', () => {
    const handlers = webHandlers(text => `«${text}»`);
    deepStrictEqual(
      REJECTED_IN_WEB.map(name => [
        thrownBy(() => handlers[name].execute()),
        handlers[name].isAvailable,
      ]),
      REJECTED_IN_WEB.map(() => [`«${MESSAGE}»`, undefined]),
    );
  });

  it('every other command is unavailable and does nothing', () => {
    const handlers = webHandlers(text => text);
    const others = PENDING_COMMANDS.filter(
      name => !(REJECTED_IN_WEB as readonly string[]).includes(name),
    );
    deepStrictEqual(
      others.map(name => [
        handlers[name].isAvailable?.(),
        handlers[name].execute(),
      ]),
      others.map(() => [false, undefined]),
    );
  });

  it('the runtime command that connects to the default distro rejects, and the others do nothing', () => {
    const handlerOf = webRuntimeHandler(text => text);
    deepStrictEqual(
      [
        thrownBy(() => handlerOf('remote-wsl.connectToWSLDefault').execute()),
        handlerOf('remote-wsl.newWindow').execute(),
        handlerOf('remote-wsl.newWindowForDistro').isAvailable?.(),
      ],
      [MESSAGE, undefined, false],
    );
  });

  it('a WSL window fails to resolve as not available, with one log line', () => {
    const lines: string[] = [];
    let resolve: (() => never) | undefined;
    let registeredFor = '';
    registerWebResolver(
      {
        register: (authority, given) => {
          registeredFor = authority;
          resolve = given;
        },
        notAvailable: message => new Error(`NotAvailable: ${message}`),
      },
      'wsl',
      REFUSAL,
      loggerInto(lines),
    );
    deepStrictEqual(
      [
        registeredFor,
        thrownBy(() => {
          resolve?.();
        }),
        lines,
      ],
      ['wsl', `NotAvailable: ${REFUSAL}`, [REFUSAL]],
    );
  });

  it('a registration the editor refuses, without the proposal, registers, writes and shows nothing', () => {
    const lines: string[] = [];
    registerWebResolver(
      {
        register: () => {
          throw new Error('proposal not enabled');
        },
        notAvailable: message => new Error(message),
      },
      'wsl',
      REFUSAL,
      loggerInto(lines),
    );
    deepStrictEqual(lines, []);
  });
});

describe('the pending commands (wsl.package)', () => {
  it('each does nothing, available exactly where the window says', () => {
    const onWindows = pendingHandlers(() => true);
    const elsewhere = pendingHandlers(() => false);
    deepStrictEqual(
      [
        PENDING_COMMANDS.length,
        onWindows.connect.isAvailable?.(),
        elsewhere.connect.isAvailable?.(),
        onWindows.showLog.execute(),
      ],
      [23, true, false, undefined],
    );
  });

  it('the runtime commands are the two new-window ids and the default-distro connect', () => {
    deepStrictEqual(RUNTIME_COMMAND_IDS, [
      'remote-wsl.newWindow',
      'remote-wsl.newWindowForDistro',
      'remote-wsl.connectToWSLDefault',
    ]);
  });
});
