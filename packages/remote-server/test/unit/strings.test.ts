import {deepStrictEqual} from 'node:assert';
import {
  DISPLAY_NAME,
  RESOLVER_UNAVAILABLE,
  STAND_DOWN_BUTTON,
  STAND_DOWN_WARNING,
} from '../../src/strings.ts';

describe('the texts of Remote - Tunnels (card #3339)', () => {
  it('F-8001 AC-14, AC-6: the coexistence warning and its button are the texts of the spec, the channel is named for the display name, and the resolver line says what is unavailable', () => {
    deepStrictEqual(
      [
        DISPLAY_NAME,
        STAND_DOWN_WARNING,
        STAND_DOWN_BUTTON,
        RESOLVER_UNAVAILABLE.startsWith('The tunnel resolver is unavailable'),
      ],
      [
        'Remote - Tunnels',
        'Remote - Tunnels (ms-vscode.remote-server) is enabled in this window. This extension stays inactive while it is enabled because both use the same commands, settings and remote resolver. Disable one of the two extensions and reload the window.',
        'Show Remote - Tunnels Extension',
        true,
      ],
    );
  });
});
