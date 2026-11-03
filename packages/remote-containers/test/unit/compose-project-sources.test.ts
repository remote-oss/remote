import {deepStrictEqual} from 'node:assert';
import {
  envProjectNameOf,
  projectSourcesOf,
} from '../../src/compose/project-sources.ts';

/** The files the client holds, by path. */
function portsOf(
  files: Record<string, string>,
  environment: Record<string, string | undefined> = {},
) {
  return {
    readText: (file: string) =>
      file in files
        ? Promise.resolve(files[file] ?? '')
        : Promise.reject(new Error('ENOENT')),
    environment,
  };
}

describe('where the Compose project name is read from (F-0413 BR-3)', () => {
  it('F-0413 AC-9: the .env line that sets COMPOSE_PROJECT_NAME is read with its value trimmed, and an empty value is none', () => {
    deepStrictEqual(
      [
        envProjectNameOf('A=1\nCOMPOSE_PROJECT_NAME= F0413 Env.Y \nB=2\n'),
        envProjectNameOf('COMPOSE_PROJECT_NAME=   \n'),
        envProjectNameOf('A=1\n'),
        envProjectNameOf(' COMPOSE_PROJECT_NAME=indented\n'),
      ],
      ['F0413 Env.Y', undefined, undefined, undefined],
    );
  });

  it('F-0413 AC-40: the sources have the editor’s name, the .env of the workspace folder and of the compose file’s folder, and the folders’ names', async () => {
    deepStrictEqual(
      await projectSourcesOf(
        portsOf(
          {
            '/w/.env': 'COMPOSE_PROJECT_NAME=a\n',
            '/w/sub/.env': 'COMPOSE_PROJECT_NAME=b\n',
          },
          {COMPOSE_PROJECT_NAME: 'proc'},
        ),
        {
          workspaceFolder: '/w',
          files: ['/w/sub/compose.yml', '/w/other.yml'],
          declaredName: 'declared',
          dashAndUnderscore: false,
        },
      ),
      {
        processName: 'proc',
        workspaceEnvName: 'a',
        composeFolderEnvName: 'b',
        declaredName: 'declared',
        workspaceBasename: 'w',
        composeFolderBasename: 'sub',
        composeFolderIsDevcontainer: false,
        dashAndUnderscore: false,
      },
    );
  });

  it('F-0413 AC-8: a compose file directly in the workspace folder’s .devcontainer is told, and a missing .env is none', async () => {
    deepStrictEqual(
      await projectSourcesOf(portsOf({}), {
        workspaceFolder: '/w',
        files: ['/w/.devcontainer/compose.yml'],
        declaredName: undefined,
        dashAndUnderscore: true,
      }),
      {
        processName: undefined,
        workspaceEnvName: undefined,
        composeFolderEnvName: undefined,
        declaredName: undefined,
        workspaceBasename: 'w',
        composeFolderBasename: '.devcontainer',
        composeFolderIsDevcontainer: true,
        dashAndUnderscore: true,
      },
    );
  });

  it('F-0413 AC-66: with no compose file, or one in the workspace folder, there is no .env of another folder', async () => {
    deepStrictEqual(
      await Promise.all(
        [[], ['/w/compose.yml']].map(
          async files =>
            (
              await projectSourcesOf(
                portsOf({'/w/.env': 'COMPOSE_PROJECT_NAME=a\n'}),
                {
                  workspaceFolder: '/w',
                  files,
                  declaredName: undefined,
                  dashAndUnderscore: true,
                },
              )
            ).composeFolderEnvName,
        ),
      ),
      [undefined, undefined],
    );
  });
});
