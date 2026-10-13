/**
 * @fileoverview The command that adds a host to an SSH configuration file: the connection command typed in an input,
 * its parse into a Host block, the file picker, the write with the creation of a missing file, and the notice with
 * its two buttons that open the file or a new window on the host. It works over ports, so it imports nothing of the
 * editor.
 */

import type {CommandHandler} from 'lib-identifiers';
import {
  type AddHostProblem,
  parseAddHostCommand,
  writeHostBlock,
} from 'lib-ssh';
import {
  type ConnectCommandEditor,
  plainAuthority,
} from '../connect/connect-commands.ts';
import {windowTargetOf} from '../connect/window-target.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {NoticePort} from '../surfaces/notice.ts';
import type {Translate} from '../surfaces/strings.ts';
import type {TextInputPort} from '../surfaces/text-input.ts';
import {buildFileChoice} from './file-choice.ts';
import {
  type ConfigFileEditor,
  type ConfigFiles,
  type ConfigFilePlaces,
  createdFile,
  pathOf,
} from './open-config-file.ts';

/** What the command needs of the client's files: those of the config file command, with the text of a file. */
export interface HostFiles extends ConfigFiles {
  read(filePath: string): PromiseLike<string>;
  /** Replaces the whole text of a file that exists; a failure rejects with the system error. */
  write(filePath: string, text: string): PromiseLike<void>;
}

/** The placeholder of the input, which is not translated. */
const PLACEHOLDER = 'E.g. ssh hello@example.com -A';

/** The text of the error for an unquoted shell character, which is not translated. */
function shellCharacterText(character: string): string {
  return `Unquoted shell character "${character}" in the SSH connection command`;
}

/** The text of the error notice for a command that cannot be read. */
function problemText(problem: AddHostProblem): string {
  return problem.kind === 'shellCharacter'
    ? shellCharacterText(problem.character)
    : problem.message;
}

/** Everything the command takes from its surroundings. */
export interface AddHostPorts {
  /** The file picker and the preview of a file. */
  editor: Pick<ConfigFileEditor, 'pickFile' | 'open'>;
  /** The new window. */
  windows: Pick<ConnectCommandEditor, 'openRemote'>;
  input: TextInputPort;
  notice: NoticePort;
  files: HostFiles;
  places: ConfigFilePlaces;
  /** `remote.SSH.configFile` as written, read at each run. */
  configFile: () => string;
  /** An English template into the display language. */
  translate: Translate;
}

/** What registration supplies: the ports of the command besides the notices, the translation and the new window. */
export type AddHostSurroundings = Omit<
  AddHostPorts,
  'windows' | 'notice' | 'translate'
>;

/** The command: ask for the connection command, pick the file, write the block, and offer the two follow-ups. */
export function addNewSshHostHandler(ports: AddHostPorts): CommandHandler {
  const {editor, windows, files, places, translate} = ports;
  return {
    execute: async () => {
      const typed = await ports.input.showInputBox({
        title: ownText({id: 'S063', values: []}, translate),
        placeholder: PLACEHOLDER,
      });
      if (typed === undefined || typed.trim() === '') {
        return;
      }
      const parsed = parseAddHostCommand(typed);
      if ('problem' in parsed) {
        await ports.notice.showError(problemText(parsed.problem), []);
        return;
      }
      const picked = await editor.pickFile(
        buildFileChoice({
          configFile: ports.configFile(),
          userFile: places.userFile,
          systemFile: places.systemFile,
        }),
      );
      if (picked?.kind !== 'file') {
        return;
      }
      const file = pathOf(
        picked,
        places.homeFolder,
        places.platform,
        translate,
      );
      const created = await createdFile(files, file, picked.role);
      await files.write(
        file,
        writeHostBlock(
          created.exists ? await files.read(file) : '',
          parsed.block,
        ),
      );
      const openConfig = ownText({id: 'S099', values: []}, translate);
      const connectNow = ownText({id: 'S025', values: []}, translate);
      const button = await ports.notice.showInformation(
        ownText({id: 'S078', values: []}, translate),
        [openConfig, connectNow],
      );
      if (button === openConfig) {
        await editor.open(file);
      } else if (button === connectNow) {
        await windows.openRemote(
          plainAuthority(parsed.block.alias),
          windowTargetOf('hostAddedConnect'),
        );
      }
    },
  };
}
