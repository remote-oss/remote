import {deepStrictEqual} from 'node:assert';
import {parseDefaultForwards} from '../../src/index.ts';

describe('parseDefaultForwards (card forwarding-02 table)', () => {
  it('F-2507.BR-2: maps a named entry with a local port', () => {
    deepStrictEqual(
      parseDefaultForwards([{name: 'web', remotePort: 8000, localPort: 18000}]),
      {
        requests: [
          {
            remoteHost: 'localhost',
            remotePort: 8000,
            localPort: 18000,
            label: 'web',
          },
        ],
        skipped: [],
      },
    );
  });

  it('F-2507.AC-3: an entry with only a remote port listens on the same port, without a label', () => {
    deepStrictEqual(parseDefaultForwards([{remotePort: 8001}]).requests, [
      {remoteHost: 'localhost', remotePort: 8001, localPort: 8001},
    ]);
  });

  it('F-2507.AC-3: a local port is kept', () => {
    deepStrictEqual(
      parseDefaultForwards([{remotePort: 8005, localPort: 8003}]).requests[0]
        ?.localPort,
      8003,
    );
  });

  it('F-2507.BR-2: three entries give three requests in list order', () => {
    deepStrictEqual(
      parseDefaultForwards([
        {name: 'web', remotePort: 8000, localPort: 18000},
        {remotePort: 8001},
        {remotePort: 8005, localPort: 8003},
      ]).requests.map(request => request.remotePort),
      [8000, 8001, 8005],
    );
  });

  it('F-2507.AC-14: a numeric string is read as the number', () => {
    deepStrictEqual(parseDefaultForwards([{remotePort: '8001'}]).requests, [
      {remoteHost: 'localhost', remotePort: 8001, localPort: 8001},
    ]);
  });

  it('F-2507.AC-15: a repeated remote port is skipped and the first stays', () => {
    deepStrictEqual(
      parseDefaultForwards([
        {remotePort: 8000, localPort: 1},
        {remotePort: 8000, localPort: 2},
      ]),
      {
        requests: [{remoteHost: 'localhost', remotePort: 8000, localPort: 1}],
        skipped: [{index: 1, reason: 'duplicateRemotePort'}],
      },
    );
  });

  it('F-2507.AC-15: a numeric string repeats a number', () => {
    deepStrictEqual(
      parseDefaultForwards([{remotePort: '8000'}, {remotePort: 8000}]),
      {
        requests: [
          {remoteHost: 'localhost', remotePort: 8000, localPort: 8000},
        ],
        skipped: [{index: 1, reason: 'duplicateRemotePort'}],
      },
    );
  });

  it('F-2507.AC-13 (provisional): an entry without a remote port is skipped', () => {
    deepStrictEqual(
      parseDefaultForwards([
        {name: 'missing', localPort: 18010},
        {remotePort: 8001},
      ]),
      {
        requests: [
          {remoteHost: 'localhost', remotePort: 8001, localPort: 8001},
        ],
        skipped: [{index: 0, reason: 'missingRemotePort'}],
      },
    );
  });

  it('F-2507.AC-13 (provisional): an undefined remote port counts as missing', () => {
    deepStrictEqual(parseDefaultForwards([{remotePort: undefined}]).skipped, [
      {index: 0, reason: 'missingRemotePort'},
    ]);
  });

  const invalidPorts: unknown[] = [
    0,
    65536,
    -1,
    80.5,
    '80x',
    '',
    ' 80',
    '+80',
    null,
    true,
    {},
  ];
  for (const remotePort of invalidPorts) {
    it(`F-2507.7.E4 (provisional): remote port ${JSON.stringify(remotePort)} is invalid`, () => {
      deepStrictEqual(parseDefaultForwards([{remotePort}]).skipped, [
        {index: 0, reason: 'invalidRemotePort'},
      ]);
    });
  }

  const notObjects: unknown[] = [8000, '8000', null, [], undefined];
  for (const entry of notObjects) {
    it(`F-2507.7.E4 (provisional): entry ${JSON.stringify(entry)} is not an object`, () => {
      deepStrictEqual(parseDefaultForwards([{remotePort: 1}, entry]).skipped, [
        {index: 1, reason: 'notAnObject'},
      ]);
    });
  }

  it('F-2507.BR-2 (provisional): skips are listed in list order', () => {
    deepStrictEqual(
      parseDefaultForwards([
        {remotePort: 'x'},
        {remotePort: 8000},
        {remotePort: 8000},
      ]),
      {
        requests: [
          {remoteHost: 'localhost', remotePort: 8000, localPort: 8000},
        ],
        skipped: [
          {index: 0, reason: 'invalidRemotePort'},
          {index: 2, reason: 'duplicateRemotePort'},
        ],
      },
    );
  });

  it('F-2507.BR-2 (provisional): an invalid entry takes no port', () => {
    deepStrictEqual(
      parseDefaultForwards([{remotePort: 'x'}, {remotePort: 'x'}]).skipped,
      [
        {index: 0, reason: 'invalidRemotePort'},
        {index: 1, reason: 'invalidRemotePort'},
      ],
    );
  });

  const noLabels: unknown[] = ['', 5, null];
  for (const name of noLabels) {
    it(`F-2507.BR-2 (provisional): name ${JSON.stringify(name)} gives no label`, () => {
      deepStrictEqual(
        parseDefaultForwards([{remotePort: 8000, name}]).requests,
        [{remoteHost: 'localhost', remotePort: 8000, localPort: 8000}],
      );
    });
  }

  const unusableLocalPorts: unknown[] = [0, 70000, 8000.5, '9000', null];
  for (const localPort of unusableLocalPorts) {
    it(`F-2507.BR-2 (provisional): local port ${JSON.stringify(localPort)} falls back to the remote port`, () => {
      deepStrictEqual(
        parseDefaultForwards([{remotePort: 8000, localPort}]).requests[0]
          ?.localPort,
        8000,
      );
    });
  }

  it('F-2507.BR-2: an empty list gives empty lists', () => {
    deepStrictEqual(parseDefaultForwards([]), {requests: [], skipped: []});
  });

  it('F-2507.BR-5: an unset setting gives empty lists and no problem', () => {
    deepStrictEqual(parseDefaultForwards(undefined), {
      requests: [],
      skipped: [],
    });
  });

  const notArrays: unknown[] = [null, '8000', 8000, {remotePort: 8000}];
  for (const settingValue of notArrays) {
    it(`F-2507.BR-5 (provisional): ${JSON.stringify(settingValue)} is not a list`, () => {
      deepStrictEqual(parseDefaultForwards(settingValue), {
        requests: [],
        skipped: [],
        settingProblem: 'notAnArray',
      });
    });
  }

  it('F-2507.BR-7: parsing the same list twice gives equal results', () => {
    const list = [{remotePort: 8000, name: 'web'}, {remotePort: 'x'}];
    deepStrictEqual(parseDefaultForwards(list), parseDefaultForwards(list));
  });

  it('F-2507.BR-7: the list is not modified', () => {
    const list = [{remotePort: 8000, name: 'web'}, {remotePort: 'x'}];
    parseDefaultForwards(list);
    deepStrictEqual(list, [{remotePort: 8000, name: 'web'}, {remotePort: 'x'}]);
  });
});
