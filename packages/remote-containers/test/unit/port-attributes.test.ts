import {deepStrictEqual} from 'node:assert';
import {portAttributeSettings} from '../../src/ports/port-attributes.ts';

/** A merged configuration with the given declared-level attributes and customizations layers. */
function merged(
  declared: {portsAttributes?: unknown; otherPortsAttributes?: unknown},
  ...layers: Array<Record<string, unknown>>
): Record<string, unknown> {
  return {
    ...declared,
    customizations: {vscode: layers.map(settings => ({settings}))},
  };
}

describe('the port attributes as machine settings (card containers-73)', () => {
  it('F-1101 AC-33: the declared-level attributes become the two keys', () => {
    deepStrictEqual(
      portAttributeSettings(
        merged({
          portsAttributes: {'3000': {label: 'App'}},
          otherPortsAttributes: {label: 'Other'},
        }),
      ),
      {
        'remote.portsAttributes': {'3000': {label: 'App'}},
        'remote.otherPortsAttributes': {label: 'Other'},
      },
    );
  });

  it('F-1101 AC-34: a key a layer names replaces the declared-level entry whole, and the keys only one side names stay', () => {
    deepStrictEqual(
      portAttributeSettings(
        merged(
          {
            portsAttributes: {
              '3000': {label: 'FromDC', onAutoForward: 'silent'},
              '4000': {label: 'DCOnly'},
            },
          },
          {
            'remote.portsAttributes': {
              '3000': {label: 'FromCust'},
              '5000': {label: 'CustOnly'},
            },
          },
        ),
      ),
      {
        'remote.portsAttributes': {
          '3000': {label: 'FromCust'},
          '4000': {label: 'DCOnly'},
          '5000': {label: 'CustOnly'},
        },
      },
    );
  });

  it('F-1101 AC-35: the last layer replaces the other-ports attributes whole; with no layer value the declared-level one stays', () => {
    const declared = {
      otherPortsAttributes: {label: 'DCOther', onAutoForward: 'silent'},
    };
    deepStrictEqual(
      [
        portAttributeSettings(
          merged(
            declared,
            {'remote.otherPortsAttributes': {label: 'First'}},
            {'remote.otherPortsAttributes': {label: 'CustOther'}},
          ),
        ),
        portAttributeSettings(merged(declared, {})),
      ],
      [
        {'remote.otherPortsAttributes': {label: 'CustOther'}},
        {
          'remote.otherPortsAttributes': {
            label: 'DCOther',
            onAutoForward: 'silent',
          },
        },
      ],
    );
  });

  it('F-1101 7.E6: a key that starts with a dash is left out, in the declared level and in a layer', () => {
    deepStrictEqual(
      portAttributeSettings(
        merged(
          {portsAttributes: {'-3000': {label: 'No'}, '4000': {label: 'Yes'}}},
          {'remote.portsAttributes': {'-5000': {label: 'No'}}},
        ),
      ),
      {'remote.portsAttributes': {'4000': {label: 'Yes'}}},
    );
  });

  it('containers-123, F-1101 AC-39: a regular-expression key that holds a dash after its start reaches the setting unchanged, with the spaced and the dotted forms side by side', () => {
    const keys = {
      '.*-p 33243 -e cat.*': {label: 'Spaced'},
      '.*-p.33243.-e.cat.*': {label: 'Dotted'},
      'nc -lk': {label: 'Regexed'},
    };
    deepStrictEqual(portAttributeSettings(merged({portsAttributes: keys})), {
      'remote.portsAttributes': keys,
    });
  });

  it('F-1101 BR-24: values that are not objects, layers that are not objects and a missing configuration give nothing', () => {
    deepStrictEqual(
      [
        portAttributeSettings(undefined),
        portAttributeSettings({}),
        portAttributeSettings({
          portsAttributes: 'x',
          otherPortsAttributes: [1],
        }),
        portAttributeSettings({
          customizations: {vscode: [null, {settings: 3}, {}]},
        }),
        portAttributeSettings({customizations: {vscode: 'x'}}),
      ],
      [{}, {}, {}, {}, {}],
    );
  });
});
