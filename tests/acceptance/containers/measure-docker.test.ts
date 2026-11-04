import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

describe('measure: the hosted runner’s Docker', () => {
  it('measure: prints the engine, the image store, Compose and BuildKit', async () => {
    for (const command of [
      ['docker', 'version', '--format', 'client {{.Client.Version}} server {{.Server.Version}}'],
      ['docker', 'info', '--format', 'driver={{.Driver}} {{.DriverStatus}}'],
      ['docker', 'compose', 'version'],
      ['docker', 'buildx', 'version'],
      ['docker', 'buildx', 'ls'],
    ]) {
      const [program = '', ...rest] = command;
      const {stdout} = await execFileAsync(program, rest).catch(
        (caught: Error) => ({stdout: `FAILED ${caught.message}`}),
      );
      console.log(`MEASURE ${command.slice(1).join(' ')} => ${stdout.trim()}`);
    }
  });
});
