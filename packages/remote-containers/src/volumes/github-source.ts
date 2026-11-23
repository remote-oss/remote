/**
 * @fileoverview The GitHub source of the clone's source pick, through the editor's own remote sources: the built-in
 * git-base extension's picker, with the GitHub provider the built-in GitHub extension registers, its sign-in and its
 * branch step. Offered only when both extensions are installed.
 */

import type {Logger} from 'lib-log';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {cloneText} from './clone-strings.ts';
import type {GithubOffer, PickedRepository} from './source-pick.ts';

/** The built-in extension whose picker lists remote sources. */
const GIT_BASE = 'vscode.git-base';

/** The built-in extension that registers the GitHub provider. */
const GITHUB = 'vscode.github';

/** The part of git-base's API this uses, as its `git-base.d.ts` declares it. */
interface GitBaseApi {
  pickRemoteSource(options: {
    providerName: string;
    title: string;
    placeholder: string;
    branch: true;
  }): Promise<string | {url: string; branch?: string} | undefined>;
}

/** The exports of the git-base extension, which give its API by version. */
interface GitBaseExports {
  getAPI(version: 1): GitBaseApi;
}

/** What the GitHub source needs of the editor. */
export interface GithubSourcePorts {
  /** Whether the extension `extensionId` is installed. */
  installed(extensionId: string): boolean;
  /** Activates the installed extension `extensionId` and gives its exports. */
  activate(extensionId: string): Promise<unknown>;
  logger: Logger;
}

/** How the GitHub row is offered in a window that is local or not: not at all when either extension is missing. */
export function githubOfferOf(
  ports: GithubSourcePorts,
  remoteWindow: boolean,
): GithubOffer {
  const missing = [GIT_BASE, GITHUB].filter(
    extensionId => !ports.installed(extensionId),
  );
  if (missing.length > 0) {
    ports.logger.info(
      `the GitHub source isn't offered: ${missing.join(' and ')} isn't installed`,
    );
    return 'none';
  }
  return remoteWindow ? 'remote' : 'local';
}

/** The repository and branch the user picks on GitHub, or nothing when the picker is left. */
export async function pickGithubRepository(
  ports: GithubSourcePorts,
  translate: Translate,
): Promise<PickedRepository | undefined> {
  const gitBase = (await ports.activate(GIT_BASE)) as GitBaseExports;
  const picked = await gitBase.getAPI(1).pickRemoteSource({
    providerName: 'GitHub',
    title: cloneText('S067', translate),
    placeholder: cloneText('S068', translate),
    branch: true,
  });
  if (picked === undefined || typeof picked === 'string') {
    return picked === undefined ? undefined : {url: picked};
  }
  return picked.branch === undefined
    ? {url: picked.url}
    : {url: picked.url, branch: picked.branch};
}
