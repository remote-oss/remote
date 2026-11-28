/**
 * @fileoverview Starts the stub identity service in its container: the table file and the port come from the
 * environment the run gives it.
 */

import {identityServer} from './identities.ts';

const tableFile = process.env.STUB_IDENTITIES;
const port = Number(process.env.STUB_PORT);
if (tableFile === undefined || !Number.isInteger(port)) {
  process.stderr.write(
    'the stub identity service needs STUB_IDENTITIES and STUB_PORT\n',
  );
  process.exit(1);
}
identityServer(tableFile).listen(port, () => {
  process.stdout.write(
    `the stub identity service answers on port ${String(port)}\n`,
  );
});
