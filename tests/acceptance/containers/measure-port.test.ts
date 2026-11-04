import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

describe('measure: the hosted engine’s error for a port that is already published', () => {
  it('measure: prints what docker says', async () => {
    const image = process.env.HARNESS_DEVCONTAINER_IMAGE ?? 'alpine:3.20';
    const {stdout} = await execFileAsync('docker', [
      'run',
      '--detach',
      '--publish',
      '127.0.0.1:0:8000',
      image,
      'sleep',
      '600',
    ]);
    const holder = stdout.trim();
    const {stdout: published} = await execFileAsync('docker', [
      'port',
      holder,
      '8000/tcp',
    ]);
    const port = published.trim().split(':').at(-1) ?? '';
    for (const mode of ['run', 'create+start']) {
      const result = await (
        mode === 'run'
          ? execFileAsync('docker', [
              'run',
              '--detach',
              '--publish',
              `${port}:8000`,
              image,
              'sleep',
              '5',
            ])
          : execFileAsync('docker', [
              'create',
              '--publish',
              `${port}:8000`,
              image,
              'sleep',
              '5',
            ]).then(created =>
              execFileAsync('docker', ['start', created.stdout.trim()]),
            )
      ).then(
        () => 'NO ERROR',
        (caught: Error) => caught.message,
      );
      console.log(`MEASURE ${mode} => ${result.replace(/\n/g, ' | ')}`);
    }
    await execFileAsync('docker', ['rm', '--force', holder]);
  });
});
