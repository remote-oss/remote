/**
 * @fileoverview The host pick of the two server maintenance commands (card task-remote-ssh-05): the fixed options
 * of the quick pick, and the step each picked row leads to.
 */

import {deepStrictEqual} from 'node:assert';
import type {PickerItem, StringRef} from '../../src/connect/picker-model.ts';
import {
  MAINTENANCE_PICKER_OPTIONS,
  maintenanceStep,
} from '../../src/maintenance/host-picker.ts';

const ADD_LABEL: StringRef = {id: 'S167', values: ['$(plus)']};
const CONF_LABEL: StringRef = {id: 'S024', values: []};

/** The two fixed rows, as the picker of the connect flow lists them. */
const ADD_HOST: PickerItem = {
  kind: 'addHost',
  label: ADD_LABEL,
  keepVisible: true,
};
const CONFIGURE: PickerItem = {
  kind: 'configure',
  label: CONF_LABEL,
  keepVisible: true,
};

/** A host row of the picker, by its label. */
function host(label: string): PickerItem {
  return {kind: 'host', label, keepVisible: false};
}

/** A typed row: the arrow marker in front of the text, and the text as typed. */
function typed(text: string): PickerItem {
  return {
    kind: 'typed',
    label: `➤ ${text}`,
    text,
    keepVisible: true,
  };
}

describe('MAINTENANCE_PICKER_OPTIONS (card task-remote-ssh-05)', () => {
  it('F-2411.5.0: the fixed options of the quick pick', () => {
    deepStrictEqual(MAINTENANCE_PICKER_OPTIONS, {
      hasTitle: false,
      canSelectMany: false,
      hasBackButton: false,
      focusFirst: true,
    });
  });
});

describe('maintenanceStep (card task-remote-ssh-05)', () => {
  it('F-2412.5.0: a listed host runs on its alias as the text', () => {
    deepStrictEqual(maintenanceStep(host('alpha')), {
      proceed: {text: 'alpha', target: {host: 'alpha'}},
    });
  });

  it('F-2412.5.0: the host label is the text, case kept', () => {
    deepStrictEqual(maintenanceStep(host('Beta-Upper')), {
      proceed: {text: 'Beta-Upper', target: {host: 'Beta-Upper'}},
    });
  });

  it('F-2411.6.3: a typed user@host:port runs on its parsed target', () => {
    deepStrictEqual(maintenanceStep(typed('lab@203.0.113.6:2222')), {
      proceed: {
        text: 'lab@203.0.113.6:2222',
        target: {host: '203.0.113.6', user: 'lab', port: 2222},
      },
    });
  });

  it('F-2412.6.4: a typed alias runs on its parsed target', () => {
    deepStrictEqual(maintenanceStep(typed('lab@alias.invalid')), {
      proceed: {
        text: 'lab@alias.invalid',
        target: {host: 'alias.invalid', user: 'lab'},
      },
    });
  });

  it('F-2411.6.3: the spaces of the typed text stay in the text and the target', () => {
    deepStrictEqual(maintenanceStep(typed(' lab@x.invalid ')), {
      proceed: {
        text: ' lab@x.invalid ',
        target: {host: 'x.invalid ', user: ' lab'},
      },
    });
  });

  it('F-2411.6.3: the text -oProxyCommand=x is not refused', () => {
    deepStrictEqual(maintenanceStep(typed('-oProxyCommand=x')), {
      proceed: {text: '-oProxyCommand=x', target: {host: '-oProxyCommand=x'}},
    });
  });

  it('F-2411.6.3: the text a b.invalid is not refused', () => {
    deepStrictEqual(maintenanceStep(typed('a b.invalid')), {
      proceed: {text: 'a b.invalid', target: {host: 'a b.invalid'}},
    });
  });

  it('F-2411.6.3: three spaces are not refused', () => {
    deepStrictEqual(maintenanceStep(typed('   ')), {
      proceed: {text: '   ', target: {host: '   '}},
    });
  });

  it('F-2411.6.4: the add-host row ends the command', () => {
    deepStrictEqual(maintenanceStep(ADD_HOST), {stop: 'addHost'});
  });

  it('F-2411.6.4: the configure row ends the command', () => {
    deepStrictEqual(maintenanceStep(CONFIGURE), {stop: 'configure'});
  });

  it('F-2412.6.5: the same two fixed rows end the uninstall', () => {
    deepStrictEqual(
      [maintenanceStep(ADD_HOST), maintenanceStep(CONFIGURE)],
      [{stop: 'addHost'}, {stop: 'configure'}],
    );
  });
});
