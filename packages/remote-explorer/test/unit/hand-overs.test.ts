import {deepStrictEqual} from 'node:assert';
import {SSH_HAND_OVERS} from 'lib-companion';
import {handOverHandlers} from '../../src/view/hand-overs.ts';
import type {ViewSession} from '../../src/view/targets.ts';

/** The "SSH" group row of the fake session. */
const GROUP = {label: 'SSH'};

/** A session whose only member is `groupOf`, which knows the group row. */
const SESSION = {
  targets: {groupOf: (value: unknown) => (value === GROUP ? GROUP : undefined)},
} as unknown as ViewSession;

/** The handlers over a host that records the commands it runs and rejects them when asked. */
function handlersOf(options: {
  session?: ViewSession | undefined;
  rejects?: boolean;
}) {
  const commands: string[] = [];
  const handlers = handOverHandlers(() => options.session, {
    executeCommand: commandId => {
      commands.push(commandId);
      return options.rejects === true
        ? Promise.reject(new Error('not found'))
        : Promise.resolve(undefined);
    },
  });
  return {handlers, commands};
}

describe('the hand-overs of the "SSH" group (F-5002)', () => {
  it('F-5002 AC-17: configureSsh runs the companion’s command for no argument, the group row and any other value', async () => {
    const {handlers, commands} = handlersOf({session: SESSION});
    await handlers.configureSsh.execute();
    await handlers.configureSsh.execute(GROUP);
    await handlers.configureSsh.execute('bogus-f5002');
    await handlers.configureSsh.execute({});
    deepStrictEqual(commands, Array(4).fill(SSH_HAND_OVERS.openConfigFile));
  });

  it('F-5002 AC-17: configureSsh hands over before the view has a session', async () => {
    const {handlers, commands} = handlersOf({session: undefined});
    await handlers.configureSsh.execute();
    deepStrictEqual(commands, [SSH_HAND_OVERS.openConfigFile]);
  });

  it('F-5002 AC-10: add runs the companion’s command for the group row only', async () => {
    const {handlers, commands} = handlersOf({session: SESSION});
    await handlers.remoteExplorerAdd.execute(GROUP);
    await handlers.remoteExplorerAdd.execute();
    await handlers.remoteExplorerAdd.execute('bogus-f5002');
    await handlers.remoteExplorerAdd.execute({});
    deepStrictEqual(commands, [SSH_HAND_OVERS.addNewSshHost]);
  });

  it('F-5002 AC-10: add runs nothing before the view has a session', async () => {
    const {handlers, commands} = handlersOf({session: undefined});
    await handlers.remoteExplorerAdd.execute(GROUP);
    deepStrictEqual(commands, []);
  });

  it('F-5102 7.E3: a command that rejects ends there for both handlers, with nothing returned', async () => {
    const {handlers, commands} = handlersOf({session: SESSION, rejects: true});
    deepStrictEqual(
      [
        await handlers.configureSsh.execute(),
        await handlers.remoteExplorerAdd.execute(GROUP),
        commands.length,
      ],
      [undefined, undefined, 2],
    );
  });
});
