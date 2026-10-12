import {deepStrictEqual} from 'node:assert';
import {shellVariantOf} from '../../../tools/host-variants.ts';
import {startHost, type RunningHost} from './host-fixture.ts';

describe('the login shell of the host variant', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
  });

  after(() => {
    host.stop();
  });

  it('tooling-14: the user harness has the login shell the process asked for, or /bin/sh', () => {
    deepStrictEqual(
      host.onHost('sh', '-c', 'getent passwd harness | cut -d: -f7').trim(),
      shellVariantOf(process.env) ?? '/bin/sh',
    );
  });
});
