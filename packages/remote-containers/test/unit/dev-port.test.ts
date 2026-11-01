import {deepStrictEqual} from 'node:assert';
import {devPortOf} from '../../src/connect/dev-port.ts';

/** A merged configuration whose `customizations.vscode` layers are `layers`. */
function layered(...layers: unknown[]): Record<string, unknown> {
  return {customizations: {vscode: layers}};
}

describe('the devPort of a configuration (card containers-107)', () => {
  it('F-0502 AC-9, AC-10: the port of customizations.vscode.devPort, and of the top-level devPort, as the server’s range', () => {
    deepStrictEqual(
      [
        devPortOf(layered({devPort: 32100})),
        devPortOf({devPort: 32100}),
        devPortOf({...layered({devPort: 32100}), devPort: 40000}),
      ],
      ['32100-32100', '32100-32100', '32100-32100'],
    );
  });

  it('F-0502 6.5: the last layer that sets it wins, and a later layer without one leaves it', () => {
    deepStrictEqual(
      [
        devPortOf(layered({devPort: 1000}, {devPort: 2000})),
        devPortOf(layered({devPort: 1000}, {extensions: []})),
        devPortOf({...layered({}), devPort: 3000}),
      ],
      ['2000-2000', '1000-1000', '3000-3000'],
    );
  });

  it('F-0502 AC-26, 7.E14: zero, a fraction, text, null and anything else give a dynamic port; 70000 is passed on to fail at the server', () => {
    deepStrictEqual(
      [
        ...[0, 1.5, 'abc', '32100', null, true, -5, [], {}, 70000].map(value =>
          devPortOf({devPort: value}),
        ),
      ],
      ['', '', '', '', '', '', '', '', '', '70000-70000'],
    );
  });

  it('F-0502 6.5: an unset devPort, no customizations and no configuration give a dynamic port', () => {
    deepStrictEqual(
      [
        devPortOf({}),
        devPortOf({customizations: {vscode: 'x'}}),
        devPortOf(layered('x', null)),
        devPortOf(undefined),
      ],
      ['', '', '', ''],
    );
  });
});
