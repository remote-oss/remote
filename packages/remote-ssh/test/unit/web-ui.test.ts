/**
 * @fileoverview The Open Web UI address of an SSH window (card remote-ssh-11): the server's port on localhost, or
 * nothing when no port is known.
 */

import {deepStrictEqual} from 'node:assert';
import {webUiUrl} from '../../src/window/web-ui.ts';

describe('webUiUrl', () => {
  it("F-2509 AC-20: the port of the window's current server opens on localhost", () => {
    deepStrictEqual(webUiUrl(41263), 'http://localhost:41263/');
  });

  it('F-2509 BR-5: a port gives the address with a trailing slash, no path', () => {
    deepStrictEqual(webUiUrl(8000), 'http://localhost:8000/');
  });

  it('F-2509 AC-19: no port, as in socket mode, opens nothing', () => {
    deepStrictEqual(webUiUrl('none'), undefined);
  });
});
