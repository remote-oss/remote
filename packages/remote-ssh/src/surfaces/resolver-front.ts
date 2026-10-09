/**
 * @fileoverview The options the SSH extension registers its resolver with: the family, a progress that cannot be
 * cancelled and shows the phase titles, and the connector and the presenter of failures behind it.
 */

import type {Connector, FailurePresenter, ResolverOptions} from 'lib-authority';
import {progressTitle} from './progress-titles.ts';
import type {Translate} from './strings.ts';

/** What the resolver options are made from. */
export interface ResolverFrontDependencies {
  connector: Connector;
  presenter: FailurePresenter;
  translate: Translate;
}

/** The options of the `ssh-remote` resolver. */
export function sshResolverOptions(
  dependencies: ResolverFrontDependencies,
): ResolverOptions {
  const {translate} = dependencies;
  return {
    family: 'ssh-remote',
    connector: dependencies.connector,
    presenter: dependencies.presenter,
    cancellable: false,
    allowsTrust: false,
    titleOf: (phase, target) => progressTitle(phase, target, translate),
    startTitle: target => progressTitle(undefined, target, translate),
  };
}
