import {deepStrictEqual} from 'node:assert';
import {
  normalizedProjectName,
  type ProjectNameSources,
  projectNameOf,
} from '../../src/compose/project-name.ts';

/** Sources with only the folder rule to go on, for a workspace folder named `workspace`. */
function sources(change: Partial<ProjectNameSources> = {}): ProjectNameSources {
  return {
    processName: undefined,
    workspaceEnvName: undefined,
    composeFolderEnvName: undefined,
    declaredName: undefined,
    workspaceBasename: 'workspace',
    composeFolderBasename: 'workspace',
    composeFolderIsDevcontainer: false,
    dashAndUnderscore: true,
    ...change,
  };
}

describe('the Compose project name (F-0413 BR-3)', () => {
  it('F-0413 AC-8: with no naming source the name is the workspace folder’s, normalized', () => {
    deepStrictEqual(
      projectNameOf(
        sources({
          workspaceBasename: 'F0413 My.App',
          composeFolderBasename: 'F0413 My.App',
        }),
      ),
      {kind: 'name', name: 'f0413myapp'},
    );
  });

  it('F-0413 AC-8: a compose file directly in .devcontainer/ gives the workspace folder’s name and _devcontainer', () => {
    deepStrictEqual(
      projectNameOf(
        sources({
          workspaceBasename: 'F-0201-AC11-4',
          composeFolderBasename: '.devcontainer',
          composeFolderIsDevcontainer: true,
        }),
      ),
      {kind: 'name', name: 'f-0201-ac11-4_devcontainer'},
    );
  });

  it('F-0413 AC-8: a compose file in .devcontainer/app/ gives the name of its folder', () => {
    deepStrictEqual(projectNameOf(sources({composeFolderBasename: 'app'})), {
      kind: 'name',
      name: 'app',
    });
  });

  it('F-0201 AC-29: with a Compose older than 1.21 the name has letters and digits only, devcontainer following', () => {
    deepStrictEqual(
      projectNameOf(
        sources({
          workspaceBasename: 'F-0201-AC11-1',
          composeFolderIsDevcontainer: true,
          dashAndUnderscore: false,
        }),
      ),
      {kind: 'name', name: 'f0201ac111devcontainer'},
    );
  });

  it('F-0413 AC-39: a name never starts with - or _, and loses the characters Compose does not allow', () => {
    deepStrictEqual(
      [
        'F0413 My.App',
        'F0413Ü',
        '_F0413lead',
        '-r11lead',
        '-_-F0413Mix.Lead',
      ].map(value => normalizedProjectName(value, true)),
      ['f0413myapp', 'f0413', 'f0413lead', 'r11lead', 'f0413mixlead'],
    );
  });

  it('F-0413 AC-39: a top-level name: is normalized the same way, and an env value of the workspace folder too', () => {
    deepStrictEqual(
      [
        projectNameOf(sources({declaredName: '-F0413NmLead'})),
        projectNameOf(sources({declaredName: 'F0413 Name.X'})),
        projectNameOf(sources({workspaceEnvName: 'F0413 Env.Y'})),
      ],
      [
        {kind: 'name', name: 'f0413nmlead'},
        {kind: 'name', name: 'f0413namex'},
        {kind: 'name', name: 'f0413envy'},
      ],
    );
  });

  it('F-0413 AC-9: the editor’s own COMPOSE_PROJECT_NAME wins over a .env, which wins over name:', () => {
    deepStrictEqual(
      [
        projectNameOf(
          sources({
            processName: 'proc',
            workspaceEnvName: 'envname',
            declaredName: 'declared',
          }),
        ),
        projectNameOf(
          sources({workspaceEnvName: 'envname', declaredName: 'declared'}),
        ),
        projectNameOf(sources({declaredName: 'declared'})),
      ],
      [
        {kind: 'name', name: 'proc'},
        {kind: 'name', name: 'envname'},
        {kind: 'name', name: 'declared'},
      ],
    );
  });

  it('F-0413 AC-40: the workspace folder’s .env wins over the one beside the compose file', () => {
    deepStrictEqual(
      [
        projectNameOf(
          sources({workspaceEnvName: 'a', composeFolderEnvName: 'b'}),
        ),
        projectNameOf(sources({composeFolderEnvName: 'b'})),
      ],
      [
        {kind: 'name', name: 'a'},
        {kind: 'name', name: 'b'},
      ],
    );
  });

  it('F-0413 AC-41: a declared name of devcontainer is used as it is', () => {
    deepStrictEqual(projectNameOf(sources({declaredName: 'devcontainer'})), {
      kind: 'name',
      name: 'devcontainer',
    });
  });

  it('F-0413 AC-57: an empty value of a source is no value, and a workspace .env that normalizes to nothing is passed over', () => {
    deepStrictEqual(
      projectNameOf(
        sources({
          processName: '',
          workspaceEnvName: '+++',
          composeFolderEnvName: '',
        }),
      ),
      {kind: 'name', name: 'workspace'},
    );
  });

  it('F-0413 AC-57: a process or beside-the-compose-file value that is not a valid name is invalid, caps included', () => {
    deepStrictEqual(
      [
        projectNameOf(sources({processName: 'F0413 Proc.Caps'})),
        projectNameOf(sources({processName: 'F0413ProcCaps'})),
        projectNameOf(sources({composeFolderEnvName: 'F0413ProcCaps'})),
      ],
      [
        {kind: 'invalid', source: 'process', value: 'F0413 Proc.Caps'},
        {kind: 'invalid', source: 'process', value: 'F0413ProcCaps'},
        {
          kind: 'invalid',
          source: 'composeFolderEnv',
          value: 'F0413ProcCaps',
        },
      ],
    );
  });

  it('F-0413 AC-57: a name: or a folder that normalizes to nothing is invalid', () => {
    deepStrictEqual(
      [
        projectNameOf(sources({declaredName: '+++'})),
        projectNameOf(
          sources({workspaceBasename: '+++', composeFolderBasename: '+++'}),
        ),
        projectNameOf(
          sources({
            workspaceBasename: '+++',
            composeFolderIsDevcontainer: true,
          }),
        ),
      ],
      [
        {kind: 'invalid', source: 'declared', value: '+++'},
        {kind: 'invalid', source: 'folder', value: '+++'},
        {kind: 'name', name: 'devcontainer'},
      ],
    );
  });
});
