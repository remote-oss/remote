import {deepStrictEqual} from 'node:assert';
import {
  containerRowsOf,
  volumeRowsOf,
} from '../../src/explorer/clean-up-scans.ts';
import type {ListedContainer} from '../../src/explorer/listed-containers.ts';
import type {ListedVolume} from '../../src/explorer/listed-volumes.ts';

let counter = 0;

/** A stopped container, with `changes` over a plain one. */
function container(changes: Partial<ListedContainer>): ListedContainer {
  counter += 1;
  return {
    id: `id${String(counter)}`,
    name: `name${String(counter)}`,
    image: 'alpine:latest',
    state: 'exited',
    createdAt: 0,
    startedAt: undefined,
    finishedAt: undefined,
    labels: {},
    binds: [],
    volumes: [],
    ...changes,
  };
}

/** A volume with `labels`. */
function volume(
  name: string,
  labels: Record<string, string> = {},
): ListedVolume {
  return {name, labels};
}

const FOLDER = 'devcontainer.local_folder';

describe('the containers Clean Up offers (card containers-168)', () => {
  it('F-0905 BR-1, BR-20, AC-9, AC-33: only an exited container with a candidate label is a row, never a created one, a running one or one with no recorded folder', () => {
    deepStrictEqual(
      containerRowsOf([
        container({id: 'a', labels: {[FOLDER]: '/h/exited'}}),
        container({
          id: 'b',
          state: 'created',
          labels: {[FOLDER]: '/h/created'},
        }),
        container({
          id: 'c',
          state: 'running',
          labels: {[FOLDER]: '/h/running'},
        }),
        container({id: 'd', labels: {}}),
        container({id: 'e', labels: {'com.docker.compose.service': 'db'}}),
      ]),
      [{label: 'exited', target: 'a'}],
    );
  });

  it('F-0905 BR-13, AC-18: a container with several candidate labels is one row for each, and removed once', () => {
    deepStrictEqual(
      containerRowsOf([
        container({
          id: 'a',
          image: 'node:20',
          labels: {
            [FOLDER]: '/h/proj',
            'vsch.local.folder': '/h/legacy',
            'vsch.local.volume': 'v',
          },
        }),
      ]),
      [
        {label: 'legacy', target: 'a'},
        {label: 'node:20', target: 'a'},
        {label: 'proj', target: 'a'},
      ],
    );
  });

  it('F-0905 BR-11, BR-19, AC-16, AC-27: a folder label shows its last segment, with slashes or backslashes, a GitHub address shows owner/repository, and a volume label shows the image', () => {
    deepStrictEqual(
      containerRowsOf([
        container({
          id: 'a',
          labels: {[FOLDER]: 'c:\\Users\\me\\src\\win-dd-basic'},
        }),
        container({id: 'b', labels: {[FOLDER]: '/h/posix/'}}),
        container({
          id: 'c',
          labels: {'vsch.local.repository': 'https://github.com/Zed/Alpha.git'},
        }),
        container({
          id: 'd',
          image: 'alpine:latest',
          labels: {'vsc.devcontainer.volume.name': 'volume-name'},
        }),
        container({
          id: 'e',
          image: 'debian:12',
          labels: {'vsch.local.volume': '/a/path/value'},
        }),
        container({
          id: 'f',
          labels: {'vsch.local.repository': '/srv/git/plain'},
        }),
      ]).map(entry => entry.label),
      [
        'alpine:latest',
        'debian:12',
        'plain',
        'posix',
        'win-dd-basic',
        'Zed/Alpha',
      ],
    );
  });

  it('F-0905 BR-12, AC-17: the rows sort by the label shown, case-insensitively, with _ before - before . before letters', () => {
    deepStrictEqual(
      containerRowsOf(
        ['gamma', 'Beta', 'a.b', 'a-b', 'a_b', 'alpha'].map(name =>
          container({id: name, labels: {[FOLDER]: `/h/${name}`}}),
        ),
      ).map(entry => entry.label),
      ['a_b', 'a-b', 'a.b', 'alpha', 'Beta', 'gamma'],
    );
  });
});

describe('the volumes Clean Up offers (card containers-168)', () => {
  it('F-0905 BR-2, BR-3, BR-15, AC-10, AC-14, AC-22, AC-33: a volume with either label is one row, unless some container in any state mounts it, and never vscode', () => {
    deepStrictEqual(
      volumeRowsOf(
        [
          volume('both', {
            'vsch.local.repository': 'x',
            'dev.container.volume': 'true',
          }),
          volume('other', {'dev.container.volume': 'true'}),
          volume('stopped', {'dev.container.volume': 'true'}),
          volume('created', {'dev.container.volume': 'true'}),
          volume('running', {'dev.container.volume': 'true'}),
          volume('vscode', {'dev.container.volume': 'true'}),
          volume('plain'),
        ],
        [
          container({volumes: ['stopped']}),
          container({state: 'created', volumes: ['created']}),
          container({state: 'running', volumes: ['running']}),
        ],
      ),
      [
        {label: 'both', target: 'both'},
        {label: 'other', target: 'other'},
      ],
    );
  });

  it('F-0905 BR-19, AC-30, AC-31, AC-32: a unique GitHub volume shows owner/repository with its pull request or branch, any other shows its name, and the rows sort by what they show', () => {
    deepStrictEqual(
      volumeRowsOf(
        [
          volume('0'.repeat(64), {
            'vsch.local.repository': 'https://github.com/zz/last',
            'vsch.local.repository.unique': 'true',
          }),
          volume('aaa-1', {
            'vsch.local.repository': 'https://github.com/Zed/Alpha',
            'vsch.local.repository.unique': 'true',
            'vsch.local.repository.branch': 'main',
          }),
          volume('aaa-2', {
            'vsch.local.repository': 'https://github.com/bob/pr-repo/pull/8',
            'vsch.local.repository.unique': 'true',
            'vsch.local.repository.branch': 'feat',
            'vsch.local.repository.pullRequestId': '9',
          }),
          volume('fixed-name', {
            'vsch.local.repository': 'https://github.com/o/r',
            'vsch.local.repository.branch': 'main',
          }),
          volume('elsewhere', {
            'vsch.local.repository': 'https://example.com/o/r',
            'vsch.local.repository.unique': 'true',
          }),
        ],
        [],
      ),
      [
        {label: 'bob/pr-repo', description: '#9', target: 'aaa-2'},
        {label: 'elsewhere', target: 'elsewhere'},
        {label: 'fixed-name', target: 'fixed-name'},
        {label: 'Zed/Alpha', description: 'main', target: 'aaa-1'},
        {label: 'zz/last', target: '0'.repeat(64)},
      ],
    );
  });
});
