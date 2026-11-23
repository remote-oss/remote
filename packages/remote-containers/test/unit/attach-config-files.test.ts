import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  applicableConfigOf,
  attachConfigFilesOf,
  imageFileNameOf,
  workspaceFolderOf,
} from '../../src/attach/config-files.ts';

describe('the attach configuration files an attach reads (card containers-162, brief-attach §5)', () => {
  it('F-0602 BR-2, AC-27, AC-28: an image’s file name keeps the reference as written with the colon and the slash escaped, and the two paths lie below the storage', () => {
    const files = attachConfigFilesOf('/storage', 'ghcr.io/org/app:1.2', 'web');
    deepStrictEqual(
      [
        imageFileNameOf('nginx:latest'),
        imageFileNameOf('localhost:5000/team/app'),
        imageFileNameOf('Nginx'),
        files,
      ],
      [
        'nginx%3alatest.json',
        'localhost%3a5000%2fteam%2fapp.json',
        'Nginx.json',
        {
          name: path.join('/storage', 'nameConfigs', 'web.json'),
          image: path.join(
            '/storage',
            'imageConfigs',
            'ghcr.io%2forg%2fapp%3a1.2.json',
          ),
        },
      ],
    );
  });

  it('F-0602 BR-1: the file of the name applies when it exists, else the file of the image, else none; each is asked for when it is used', async () => {
    const files = {name: '/n.json', image: '/i.json'};
    const asked: string[] = [];
    function existing(
      ...present: string[]
    ): (file: string) => Promise<boolean> {
      return file => {
        asked.push(file);
        return Promise.resolve(present.includes(file));
      };
    }
    deepStrictEqual(
      [
        await applicableConfigOf(files, existing('/n.json', '/i.json')),
        await applicableConfigOf(files, existing('/i.json')),
        await applicableConfigOf(files, existing()),
        asked,
      ],
      [
        '/n.json',
        '/i.json',
        undefined,
        ['/n.json', '/n.json', '/i.json', '/n.json', '/i.json'],
      ],
    );
  });

  it('F-0602 7.E2: the working folder is read tolerantly, comments, a trailing comma and a missing comma included, and taken literally', () => {
    deepStrictEqual(
      [
        workspaceFolderOf('{"workspaceFolder": "/srv/app"}'),
        workspaceFolderOf(
          '// the folder\n{"workspaceFolder": "/srv/app", /* x */ }',
        ),
        workspaceFolderOf(
          '{"extensions": ["a"] "workspaceFolder": "/srv/app"}',
        ),
        workspaceFolderOf('{"workspaceFolder": "/srv/${name}"}'),
      ],
      ['/srv/app', '/srv/app', '/srv/app', '/srv/${name}'],
    );
  });

  it('F-0602 E6: a working folder that is not absolute, not text, absent, or a file that is no object gives none', () => {
    deepStrictEqual(
      [
        workspaceFolderOf('{"workspaceFolder": "src"}'),
        workspaceFolderOf('{"workspaceFolder": 3}'),
        workspaceFolderOf('{"name": "x"}'),
        workspaceFolderOf('[]'),
        workspaceFolderOf(''),
      ],
      [undefined, undefined, undefined, undefined, undefined],
    );
  });
});
