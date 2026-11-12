import {execFileSync} from 'node:child_process';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';

/** Runs `script` in a shell on the harness display and gives its output, or the error's text. */
function shell(script: string): string {
  try {
    return execFileSync('sh', ['-c', script], {
      encoding: 'utf8',
      env: {...process.env, DISPLAY: ':99'},
      timeout: 120_000,
    });
  } catch (caught) {
    return `FAILED: ${String(caught)}`;
  }
}

describe('a probe of the native folder dialog (card tooling-209)', function () {
  this.timeout(300_000);

  it('probe: what the display shows and whether a key driver can answer the chooser', async () => {
    console.log(
      'PROBE install:',
      shell('sudo apt-get install -y x11-utils xdotool 2>&1 | tail -3'),
    );
    await setUserSetting('files.simpleDialog.enable', false);
    const target = devContainerFolder('probe-target', {name: 'Probe Target'});
    const window = await openFolderWindow(
      devContainerFolder('probe-start', {name: 'Probe Start'}),
    );
    try {
      inWindow(window, 'remote-containers.openFolder').catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 8000));
      console.log('PROBE tree:', shell('xwininfo -root -tree 2>&1 | head -80'));
      console.log(
        'PROBE names:',
        shell(
          `for id in $(xdotool search --onlyvisible --name '.' 2>/dev/null); do printf '%s %s\\n' "$id" "$(xdotool getwindowname $id 2>/dev/null)"; done`,
        ),
      );
      const typed = shell(
        `id=$(xdotool search --onlyvisible --name 'Select Folder' 2>/dev/null | tail -1); echo "chooser=$id"; xdotool windowactivate --sync $id; echo "activate=$?"; sleep 1; echo "focused=$(xdotool getwindowfocus getwindowname)"; xdotool key --clearmodifiers ctrl+l; echo "ctrl+l=$?"; sleep 1; xdotool type --clearmodifiers --delay 60 '${target}'; echo "type=$?"; sleep 1; xdotool key --clearmodifiers Return; echo "return=$?"; sleep 2; echo "still=$(xdotool search --onlyvisible --name 'Select Folder' 2>/dev/null | tail -1)"`,
      );
      console.log('PROBE typed:', typed);
      await new Promise(resolve => setTimeout(resolve, 8000));
      console.log(
        'PROBE after:',
        JSON.stringify(await windowState(window)),
        shell('xwininfo -root -tree 2>&1 | head -40'),
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
