// Measure branch only: started detached with no console, as the connection helper is; runs ssh as the helper does
// and writes the timeline to the file named by its first argument.
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const [outFile, config, remoteProgram, frame, hideArgument] = process.argv.slice(2);
const started = Date.now();
const events = [];
const note = what => {
  events.push(`${String(Date.now() - started)}ms ${what}`);
  writeFileSync(outFile, JSON.stringify(events));
};
const child = spawn('ssh', ['-T', '-F', config, 'winhost', remoteProgram], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: hideArgument === 'hide',
});
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
let stdout = '';
let written = false;
child.stdout.on('data', text => {
  stdout += text;
  note(`stdout ${JSON.stringify(text.slice(0, 120))}`);
  if (!written && stdout.includes('LAYER1-READY')) {
    written = true;
    child.stdin.write(frame, () => note('frame flushed'));
    note('frame written');
  }
});
child.stderr.on('data', text => note(`stderr ${JSON.stringify(text.slice(0, 200))}`));
child.on('error', error => note(`error ${String(error)}`));
setTimeout(() => {
  note('killed');
  child.kill();
  process.exit(0);
}, 20_000);
