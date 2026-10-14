import {deepStrictEqual} from 'node:assert';
import {
  type ClientLocations,
  type ConfigFileReader,
  type HostListResult,
  listHosts,
} from 'lib-ssh';
import {
  outcomeOfPick,
  pickerModel,
  type PickerItem,
  type PickerModel,
  type StringRef,
} from '../../src/connect/picker-model.ts';

const HOSTS: HostListResult = {
  hosts: [
    {name: 'alpha', file: 'A'},
    {name: 'Beta-Upper', file: 'A'},
  ],
};

const NONE: HostListResult = {hosts: []};

/** A Linux client whose home is /home/dev. */
const LINUX: ClientLocations = {homeFolder: '/home/dev', platform: 'linux'};

/** The host listing of a client whose only configuration file is the user file with `text`. */
function listingOf(text: string): HostListResult {
  const reader: ConfigFileReader = {
    readText: file => (file === '/home/dev/.ssh/config' ? text : undefined),
    listFolder: () => undefined,
  };
  return listHosts('', LINUX, reader);
}

const ADD_LABEL: StringRef = {id: 'S167', values: ['$(plus)']};
const CONF_LABEL: StringRef = {id: 'S024', values: []};

/** The two fixed rows, the add row and the configure row. */
const FIXED_ITEMS: PickerItem[] = [
  {kind: 'addHost', label: ADD_LABEL, keepVisible: true},
  {kind: 'configure', label: CONF_LABEL, keepVisible: true},
];

/** A picker item written short: the label of a host, the text of a typed item, or a fixed item. */
function item(kind: string, nameOrText = ''): PickerItem {
  if (kind === 'host') {
    return {kind: 'host', label: nameOrText, keepVisible: false};
  }
  if (kind === 'typed') {
    return {
      kind: 'typed',
      label: `➤ ${nameOrText}`,
      text: nameOrText,
      keepVisible: true,
    };
  }
  if (kind === 'add') {
    return {kind: 'addHost', label: ADD_LABEL, keepVisible: true};
  }
  return {kind: 'configure', label: CONF_LABEL, keepVisible: true};
}

/** The model a row expects: the placeholder, the host rows, the typed row when the row has one, and the fixed rows. */
function expected(
  hosts: Array<[string, boolean]>,
  typed?: {label: string; text: string},
): PickerModel {
  const items: PickerItem[] = hosts.map(([name, keepVisible]) => ({
    kind: 'host',
    label: name,
    keepVisible,
  }));
  if (typed !== undefined) {
    items.push({
      kind: 'typed',
      label: typed.label,
      text: typed.text,
      keepVisible: true,
    });
  }
  return {
    placeholder: {id: 'S127', values: []},
    items: [...items, ...FIXED_ITEMS],
  };
}

describe('pickerModel (card remote-ssh-02)', () => {
  it('F-2301.AC-4: the listing and the fixed items, nothing typed', () => {
    deepStrictEqual(
      pickerModel(HOSTS, ''),
      expected([
        ['alpha', false],
        ['Beta-Upper', false],
      ]),
    );
  });

  it('F-2202 AC-1: the names of the Host lines, in file order, are host rows with a label only, before the fixed rows', () => {
    deepStrictEqual(
      pickerModel(
        listingOf('Host one\nHost two three   four\nHost last\n'),
        '',
      ),
      expected([
        ['one', false],
        ['two', false],
        ['three', false],
        ['four', false],
        ['last', false],
      ]),
    );
  });

  it('F-2202 AC-19: 4200 names reach the picker in file order, within a second of a two-host file', () => {
    const text = [
      ...[...Array(2000).keys()].map(
        index => `Host a-${String(index)} b-${String(index)}`,
      ),
      ...[...Array(200).keys()].map(index => `Match host m-${String(index)}`),
    ].join('\n');
    function timed(text: string): {labels: unknown[]; took: number} {
      const before = performance.now();
      const model = pickerModel(listingOf(text), '');
      return {
        labels: 'items' in model ? model.items.map(item => item.label) : [],
        took: performance.now() - before,
      };
    }
    const large = timed(text);
    const small = timed('Host x y');
    deepStrictEqual(
      [
        large.labels.length,
        large.labels[0],
        large.labels[1],
        large.labels[4199],
        large.took - small.took < 1000,
      ],
      [4202, 'a-0', 'b-0', 'm-199', true],
    );
  });

  it('F-2301.AC-5: a listing with no hosts has only the fixed items', () => {
    deepStrictEqual(pickerModel(NONE, ''), expected([]));
  });

  it('F-2301.AC-8: the typed text is an item between the hosts and the fixed items', () => {
    deepStrictEqual(
      pickerModel(HOSTS, 'lab@x'),
      expected(
        [
          ['alpha', false],
          ['Beta-Upper', false],
        ],
        {label: '➤ lab@x', text: 'lab@x'},
      ),
    );
  });

  it('F-2301.AC-8: a typed item with no hosts at all', () => {
    deepStrictEqual(
      pickerModel(NONE, 'zzz'),
      expected([], {label: '➤ zzz', text: 'zzz'}),
    );
  });

  it('F-2301.AC-29: a typed text of only spaces is the arrow alone and keeps the hosts visible', () => {
    deepStrictEqual(
      pickerModel(HOSTS, '   '),
      expected(
        [
          ['alpha', true],
          ['Beta-Upper', true],
        ],
        {label: '➤', text: '   '},
      ),
    );
  });

  it('F-2301.6.1: a typed single tab is the same shape as the three spaces', () => {
    deepStrictEqual(
      pickerModel(HOSTS, '\t'),
      expected(
        [
          ['alpha', true],
          ['Beta-Upper', true],
        ],
        {label: '➤', text: '\t'},
      ),
    );
  });

  it('F-2301.AC-30: a typed text that names a listed host is still a typed item', () => {
    deepStrictEqual(
      pickerModel(HOSTS, 'alpha'),
      expected(
        [
          ['alpha', false],
          ['Beta-Upper', false],
        ],
        {label: '➤ alpha', text: 'alpha'},
      ),
    );
  });

  it('F-2301.6.1: a typed text with the spaces as typed', () => {
    deepStrictEqual(
      pickerModel(HOSTS, ' lab@x '),
      expected(
        [
          ['alpha', false],
          ['Beta-Upper', false],
        ],
        {label: '➤  lab@x ', text: ' lab@x '},
      ),
    );
  });

  it('F-2301.BR-2: a repeated host name from two files is two items in order', () => {
    const doubled: HostListResult = {
      hosts: [
        {name: 'dup', file: 'A'},
        {name: 'dup', file: 'B'},
      ],
    };
    deepStrictEqual(
      pickerModel(doubled, ''),
      expected([
        ['dup', false],
        ['dup', false],
      ]),
    );
  });

  it('F-2301.AC-25: a call with other text in between changes no result', () => {
    const first = pickerModel(HOSTS, '');
    pickerModel(HOSTS, 'lab@x');
    deepStrictEqual(pickerModel(HOSTS, ''), first);
  });

  it('F-2301.AC-24: a listing that did not parse is the same error', () => {
    const broken: HostListResult = {
      parseError: {file: 'F', reason: 'R'},
    };
    deepStrictEqual(pickerModel(broken, ''), {
      parseError: {file: 'F', reason: 'R'},
    });
  });

  it('F-2201 AC-2: a host defined in the user file and in the system file is listed twice', () => {
    const model = pickerModel(
      {
        hosts: [
          {name: 'both', file: '/home/dev/.ssh/config'},
          {name: 'both', file: '/etc/ssh/ssh_config'},
        ],
      },
      '',
    );
    deepStrictEqual(
      'items' in model
        ? model.items
            .filter(item => item.kind === 'host')
            .map(item => item.label)
        : model,
      ['both', 'both'],
    );
  });
});

describe('outcomeOfPick (card remote-ssh-02)', () => {
  it('F-2301.AC-6: a picked host connects to its alias', () => {
    deepStrictEqual(outcomeOfPick(item('host', 'alpha')), {
      connect: {host: 'alpha'},
    });
  });

  it('F-2301.AC-33: a picked host keeps the case of its alias', () => {
    deepStrictEqual(outcomeOfPick(item('host', 'Beta-Upper')), {
      connect: {host: 'Beta-Upper'},
    });
  });

  it('F-2301.AC-10: a picked typed text is parsed into a target', () => {
    deepStrictEqual(outcomeOfPick(item('typed', 'lab@h:2222')), {
      connect: {host: 'h', user: 'lab', port: 2222},
    });
  });

  it('F-2411 6.3, F-2301.BR-7: a typed item with option text is never refused here', () => {
    deepStrictEqual(outcomeOfPick(item('typed', '-oProxyCommand=x')), {
      connect: {host: '-oProxyCommand=x'},
    });
  });

  it('F-2301.BR-7: a typed item with a percent sign is never refused here', () => {
    deepStrictEqual(outcomeOfPick(item('typed', 'a%b.invalid')), {
      connect: {host: 'a%b.invalid'},
    });
  });

  it('F-2411 6.3, F-2301.BR-7: a typed item with a space is never refused here', () => {
    deepStrictEqual(outcomeOfPick(item('typed', 'a b.invalid')), {
      connect: {host: 'a b.invalid'},
    });
  });

  it('F-2411 6.3, F-2301.AC-29: a picked typed text of spaces is the host of spaces', () => {
    deepStrictEqual(outcomeOfPick(item('typed', '   ')), {
      connect: {host: '   '},
    });
  });

  it('F-2411 6.3: the leading and trailing spaces of a typed text stay in its target', () => {
    deepStrictEqual(outcomeOfPick(item('typed', ' lab@x.invalid ')), {
      connect: {host: 'x.invalid ', user: ' lab'},
    });
  });

  it('F-2301.AC-16: a picked add item hands over', () => {
    deepStrictEqual(outcomeOfPick(item('add')), {handOver: 'addHost'});
  });

  it('F-2301.AC-18: a picked configure item hands over', () => {
    deepStrictEqual(outcomeOfPick(item('conf')), {handOver: 'configure'});
  });
});
