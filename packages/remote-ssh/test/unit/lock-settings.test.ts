import {deepStrictEqual} from 'node:assert';
import {jsonOf} from './manifest.fixture.ts';

/** What the manifest declares of `key`, with the text of its description from the strings file. */
function declaredAs(key: string): Record<string, unknown> {
  const properties = (
    (jsonOf('package.json').contributes as {configuration: unknown})
      .configuration as {properties: Record<string, Record<string, unknown>>}
  ).properties;
  const setting = properties[key] ?? {};
  const reference = String(setting.markdownDescription).replaceAll('%', '');
  return {
    type: setting.type,
    default: setting.default,
    scope: setting.scope,
    description: jsonOf('package.nls.json')[reference],
  };
}

describe('the two lock settings in the manifest (card #2819, F-2408 3.2)', () => {
  it('F-2408 AC-1: remote.SSH.lockfilesInTmp is a boolean, false by default, application scope, with the exact description', () => {
    deepStrictEqual(declaredAs('remote.SSH.lockfilesInTmp'), {
      type: 'boolean',
      default: false,
      scope: 'application',
      description:
        "Whether to keep lockfiles in `/tmp` instead of in the server's install folder. Useful for connecting to hosts which have issues with locking, such as hosts with a home directory using NFS or another distributed filesystem.",
    });
  });

  it('F-2408 AC-2: remote.SSH.useFlock is a boolean, true by default, application scope, with the exact description', () => {
    deepStrictEqual(declaredAs('remote.SSH.useFlock'), {
      type: 'boolean',
      default: true,
      scope: 'application',
      description:
        'Whether to use `flock` for creating lockfiles on Linux remotes instead of `ln`. By default, we use `flock` on Linux remotes and `ln` on macOS.',
    });
  });
});
