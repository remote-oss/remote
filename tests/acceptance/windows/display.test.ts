/**
 * @fileoverview display: the readout of the display's visible windows, each with its name, its WM_CLASS and whether
 * the window manager manages it.
 */

import {deepStrictEqual, throws} from 'node:assert';
import {listedWindows, listedWindowsOf} from './display.ts';

describe('display (card #3210)', () => {
  it('card #3210: the readout holds every visible window, with its name, its WM_CLASS and whether the manager manages it', () => {
    function driver(...words: string[]): string {
      if (words[0] === 'search') {
        return '514\n4194465';
      }
      if (words[0] === 'getwindowname' && words[1] === '514') {
        return 'VSCodium - Insiders';
      }
      if (words[0] === 'getwindowname' && words[1] === '4194465') {
        return '';
      }
      throw new Error(`no answer for ${words.join(' ')}`);
    }
    deepStrictEqual(
      listedWindowsOf(
        driver,
        windowId => windowId === '4194465',
        windowId => (windowId === '514' ? '"VSCodium", "VSCodium"' : 'none'),
      ),
      [
        {
          id: '514',
          name: 'VSCodium - Insiders',
          windowClass: '"VSCodium", "VSCodium"',
          managed: false,
        },
        {
          id: '4194465',
          name: '',
          windowClass: 'none',
          managed: true,
        },
      ],
    );
  });

  it('card #3210: a display that holds no window gives no readout', () => {
    function driver(): string {
      const error = new Error('no window') as Error & {
        status: number;
        stderr: string;
      };
      error.status = 1;
      error.stderr = '';
      throw error;
    }
    deepStrictEqual(
      listedWindowsOf(
        driver,
        () => false,
        () => 'none',
      ),
      [],
    );
  });

  it('card #3210: a display that fails the search gives no readout', () => {
    function driver(): string {
      const error = new Error('the display is not visible') as Error & {
        status: number;
        stderr: string;
      };
      error.status = 1;
      error.stderr = 'Failed creating new xdo instance.';
      throw error;
    }
    throws(
      () =>
        listedWindowsOf(
          driver,
          () => false,
          () => 'none',
        ),
      /the display is not visible/,
    );
  });

  it('card #3210: a window the display gives no name to holds no name at the readout', () => {
    function driver(...words: string[]): string {
      if (words[0] === 'search') {
        return '514';
      }
      throw new Error('the window is gone');
    }
    deepStrictEqual(
      listedWindowsOf(
        driver,
        () => true,
        () => 'none',
      ),
      [{id: '514', name: '', windowClass: 'none', managed: true}],
    );
  });

  it('card #3210: the harness display gives the readout through the harness itself', () => {
    deepStrictEqual(
      listedWindows().every(
        each =>
          typeof each.id === 'string' &&
          typeof each.name === 'string' &&
          typeof each.windowClass === 'string' &&
          typeof each.managed === 'boolean',
      ),
      true,
    );
  });
});
