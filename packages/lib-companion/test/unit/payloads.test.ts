/**
 * @fileoverview The payload codecs of the companion interface (card companion-02): every row of the card's table,
 * one case per input.
 */

import {deepStrictEqual} from 'node:assert';
import {
  readActiveFoldersPush,
  readActiveRemote,
  readDeleteRequest,
  readDeleteResult,
  readEnvelope,
  readFoldersHistory,
  readHostnames,
  readOpenRequest,
  writeActiveFoldersPush,
  writeActiveRemote,
  writeDeleteRequest,
  writeDeleteResult,
  writeEnvelope,
  writeFoldersHistory,
  writeHostnames,
  writeOpenRequest,
} from '../../src/index.ts';

/** A raw payload speaking interface version 1.0, with the given fields over the envelope. */
function payload(fields: Record<string, unknown>): Record<string, unknown> {
  return {interfaceVersion: {major: 1, minor: 0}, ...fields};
}

/** The hosts of the folders-history row: two hosts, three entries on the first, order and repeats kept. */
const historyHosts = [
  {
    hostKey: 'h1',
    entries: [
      {path: '/b', kind: 'folder'},
      {path: '/w.code-workspace', kind: 'workspace'},
      {path: '/b', kind: 'folder'},
    ],
  },
  {hostKey: 'h2', entries: []},
];

describe('the payload codecs (card companion-02)', () => {
  it('F-5902.5.rules: the version 1.0 envelope is valid', () => {
    deepStrictEqual(readEnvelope(payload({})), {
      status: 'valid',
      value: {interfaceVersion: {major: 1, minor: 0}},
    });
  });

  it('F-5902.5.rules: a minor of 9 is kept and an extra field is dropped', () => {
    deepStrictEqual(
      readEnvelope({interfaceVersion: {major: 1, minor: 9, x: 1}}),
      {status: 'valid', value: {interfaceVersion: {major: 1, minor: 9}}},
    );
  });

  it('F-5902.5.foreign: readEnvelope of undefined is refused as foreign', () => {
    deepStrictEqual(readEnvelope(undefined), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: readEnvelope of null is refused as foreign', () => {
    deepStrictEqual(readEnvelope(null), {status: 'refused', reason: 'foreign'});
  });

  it('F-5902.5.foreign: readEnvelope of a string is refused as foreign', () => {
    deepStrictEqual(readEnvelope('text'), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: readEnvelope of an array is refused as foreign', () => {
    deepStrictEqual(readEnvelope([]), {status: 'refused', reason: 'foreign'});
  });

  it('F-5902.5.foreign: readEnvelope of an object without a version is refused as foreign', () => {
    deepStrictEqual(readEnvelope({}), {status: 'refused', reason: 'foreign'});
  });

  it('F-5902.5.foreign: readEnvelope of a body without a version is refused as foreign', () => {
    deepStrictEqual(readEnvelope({connected: false}), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: a major that is the string 1 is refused as foreign', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: {major: '1', minor: 0}}), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: a missing minor is refused as foreign', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: {major: 1}}), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: a major of 1.5 is refused as foreign', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: {major: 1.5, minor: 0}}), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: a major of -1 is refused as foreign', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: {major: -1, minor: 0}}), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: a version of null is refused as foreign', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: null}), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.foreign: readEnvelope of major 0 is refused as unknownMajor', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: {major: 0, minor: 0}}), {
      status: 'refused',
      reason: 'unknownMajor',
    });
  });

  it('F-5902.5.foreign: readEnvelope of major 2 is refused as unknownMajor', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: {major: 2, minor: 0}}), {
      status: 'refused',
      reason: 'unknownMajor',
    });
  });

  it('F-5902.5.foreign: readEnvelope of major 99 is refused as unknownMajor', () => {
    deepStrictEqual(readEnvelope({interfaceVersion: {major: 99, minor: 0}}), {
      status: 'refused',
      reason: 'unknownMajor',
    });
  });

  it('F-5902.5.foreign: readActiveRemote of major 2 is refused as unknownMajor, before the body', () => {
    deepStrictEqual(
      readActiveRemote(
        payload({interfaceVersion: {major: 2, minor: 0}, connected: 'no'}),
      ),
      {status: 'refused', reason: 'unknownMajor'},
    );
  });

  it('F-5902.5.table: a connected remote keeps its host key, case and all', () => {
    deepStrictEqual(
      readActiveRemote(payload({connected: true, hostKey: 'Build-Box'})),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          connected: true,
          hostKey: 'Build-Box',
        },
      },
    );
  });

  it('F-5902.5.table: a connected remote keeps a hex host key unchanged', () => {
    deepStrictEqual(
      readActiveRemote(
        payload({
          connected: true,
          hostKey:
            '7b22686f73744e616d65223a22616c706861222c2275736572223a226c6162227d',
        }),
      ),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          connected: true,
          hostKey:
            '7b22686f73744e616d65223a22616c706861222c2275736572223a226c6162227d',
        },
      },
    );
  });

  it('F-5902.5.table: a disconnected remote has no host key property', () => {
    deepStrictEqual(readActiveRemote(payload({connected: false})), {
      status: 'valid',
      value: {interfaceVersion: {major: 1, minor: 0}, connected: false},
    });
  });

  it('F-5902.5.table: a disconnected remote drops a host key property', () => {
    deepStrictEqual(
      readActiveRemote(payload({connected: false, hostKey: 'x'})),
      {
        status: 'valid',
        value: {interfaceVersion: {major: 1, minor: 0}, connected: false},
      },
    );
  });

  it('F-5902.5.table: a connected remote without a host key is refused as foreign', () => {
    deepStrictEqual(readActiveRemote(payload({connected: true})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.table: a connection that is not a boolean is refused as foreign', () => {
    deepStrictEqual(readActiveRemote(payload({connected: 'yes'})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.table: a host key that is a number is refused as foreign', () => {
    deepStrictEqual(readActiveRemote(payload({connected: true, hostKey: 5})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.table: hostnames keep their order and their repeats', () => {
    deepStrictEqual(readHostnames(payload({hostnames: ['b', 'A', 'b']})), {
      status: 'valid',
      value: {
        interfaceVersion: {major: 1, minor: 0},
        hostnames: ['b', 'A', 'b'],
      },
    });
  });

  it('F-5902.5.table: no hostnames is an empty list', () => {
    deepStrictEqual(readHostnames(payload({hostnames: []})), {
      status: 'valid',
      value: {interfaceVersion: {major: 1, minor: 0}, hostnames: []},
    });
  });

  it('F-5902.5.table: a hostname that is a number is refused as foreign', () => {
    deepStrictEqual(readHostnames(payload({hostnames: ['a', 5]})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.table: a missing hostnames field is refused as foreign', () => {
    deepStrictEqual(readHostnames(payload({})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.table: the folders history keeps order, repeats and both kinds', () => {
    deepStrictEqual(readFoldersHistory(payload({hosts: historyHosts})), {
      status: 'valid',
      value: {
        interfaceVersion: {major: 1, minor: 0},
        hosts: historyHosts,
      },
    });
  });

  it('F-5902.5.table: an entry of kind file is refused as foreign', () => {
    deepStrictEqual(
      readFoldersHistory(
        payload({
          hosts: [{hostKey: 'h1', entries: [{path: '/b', kind: 'file'}]}],
        }),
      ),
      {status: 'refused', reason: 'foreign'},
    );
  });

  it('F-5902.5.table: an entry that is a string is refused as foreign', () => {
    deepStrictEqual(
      readFoldersHistory(payload({hosts: [{hostKey: 'h1', entries: ['/a']}]})),
      {status: 'refused', reason: 'foreign'},
    );
  });

  it('F-5902.5.table: an entry without a path is refused as foreign', () => {
    deepStrictEqual(
      readFoldersHistory(
        payload({hosts: [{hostKey: 'h1', entries: [{kind: 'folder'}]}]}),
      ),
      {status: 'refused', reason: 'foreign'},
    );
  });

  it('F-5104.BR-13: a delete request with host key and path is valid', () => {
    deepStrictEqual(readDeleteRequest(payload({hostKey: 'h1', path: '/b'})), {
      status: 'valid',
      value: {
        interfaceVersion: {major: 1, minor: 0},
        hostKey: 'h1',
        path: '/b',
      },
    });
  });

  it('F-5104.BR-13: a delete request without a path is refused as foreign', () => {
    deepStrictEqual(readDeleteRequest(payload({hostKey: 'h1'})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5104.BR-13: a delete result of changed false is valid', () => {
    deepStrictEqual(readDeleteResult(payload({changed: false})), {
      status: 'valid',
      value: {interfaceVersion: {major: 1, minor: 0}, changed: false},
    });
  });

  it('F-5104.BR-13: a changed flag that is a number is refused as foreign', () => {
    deepStrictEqual(readDeleteResult(payload({changed: 1})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5103.BR-1: an open request for a new window has no path or kind property', () => {
    deepStrictEqual(
      readOpenRequest(payload({hostKey: 'Alias', window: 'new'})),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          hostKey: 'Alias',
          window: 'new',
        },
      },
    );
  });

  it('F-5103.BR-1: an open request for the current window has no path or kind property', () => {
    deepStrictEqual(
      readOpenRequest(payload({hostKey: 'Alias', window: 'current'})),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          hostKey: 'Alias',
          window: 'current',
        },
      },
    );
  });

  it('F-5103.BR-1: a window that is neither current nor new is refused as foreign', () => {
    deepStrictEqual(
      readOpenRequest(payload({hostKey: 'Alias', window: 'other'})),
      {status: 'refused', reason: 'foreign'},
    );
  });

  it('F-5104.BR-15: a path and its kind are copied as given, case and all', () => {
    deepStrictEqual(
      readOpenRequest(
        payload({
          hostKey: 'Alias',
          path: '/w/UP.CODE-WORKSPACE',
          kind: 'folder',
          window: 'new',
        }),
      ),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          hostKey: 'Alias',
          path: '/w/UP.CODE-WORKSPACE',
          kind: 'folder',
          window: 'new',
        },
      },
    );
  });

  it('F-5104.BR-15: a workspace path keeps the kind the sender decided', () => {
    deepStrictEqual(
      readOpenRequest(
        payload({
          hostKey: 'Alias',
          path: '/w/a.code-workspace',
          kind: 'workspace',
          window: 'new',
        }),
      ),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          hostKey: 'Alias',
          path: '/w/a.code-workspace',
          kind: 'workspace',
          window: 'new',
        },
      },
    );
  });

  it('F-5902.5.push: a failed push with a host key is valid', () => {
    deepStrictEqual(
      readActiveFoldersPush(payload({outcome: 'failed', hostKey: 'h'})),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          outcome: 'failed',
          hostKey: 'h',
        },
      },
    );
  });

  it('F-5902.5.push: a none outcome alone has no host key or folders property', () => {
    deepStrictEqual(readActiveFoldersPush(payload({outcome: 'none'})), {
      status: 'valid',
      value: {interfaceVersion: {major: 1, minor: 0}, outcome: 'none'},
    });
  });

  it('F-5902.5.push: a connected push with host key and folders is valid', () => {
    deepStrictEqual(
      readActiveFoldersPush(
        payload({outcome: 'connected', hostKey: 'h', folders: ['/a', '/b']}),
      ),
      {
        status: 'valid',
        value: {
          interfaceVersion: {major: 1, minor: 0},
          outcome: 'connected',
          hostKey: 'h',
          folders: ['/a', '/b'],
        },
      },
    );
  });

  it('F-5902.5.push: an outcome that is neither connected, failed nor none is refused as foreign', () => {
    deepStrictEqual(readActiveFoldersPush(payload({outcome: 'done'})), {
      status: 'refused',
      reason: 'foreign',
    });
  });

  it('F-5902.5.push: a folder that is a number is refused as foreign', () => {
    deepStrictEqual(
      readActiveFoldersPush(payload({outcome: 'connected', folders: [1]})),
      {status: 'refused', reason: 'foreign'},
    );
  });

  it('F-5902.5.rules: writeEnvelope reads back as valid and identical', () => {
    const written = writeEnvelope();
    deepStrictEqual(
      {result: readEnvelope(written), firstKey: Object.keys(written)[0]},
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeActiveRemote reads back as valid and identical', () => {
    const written = writeActiveRemote({connected: true, hostKey: 'Build-Box'});
    deepStrictEqual(
      {result: readActiveRemote(written), firstKey: Object.keys(written)[0]},
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeHostnames reads back as valid and identical', () => {
    const written = writeHostnames({hostnames: ['b', 'A', 'b']});
    deepStrictEqual(
      {result: readHostnames(written), firstKey: Object.keys(written)[0]},
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeFoldersHistory reads back as valid and identical', () => {
    const written = writeFoldersHistory({
      hosts: [
        {hostKey: 'h1', entries: [{path: '/b', kind: 'folder'}]},
        {hostKey: 'h2', entries: []},
      ],
    });
    deepStrictEqual(
      {result: readFoldersHistory(written), firstKey: Object.keys(written)[0]},
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeDeleteRequest reads back as valid and identical', () => {
    const written = writeDeleteRequest({hostKey: 'h1', path: '/b'});
    deepStrictEqual(
      {result: readDeleteRequest(written), firstKey: Object.keys(written)[0]},
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeDeleteResult reads back as valid and identical', () => {
    const written = writeDeleteResult({changed: false});
    deepStrictEqual(
      {result: readDeleteResult(written), firstKey: Object.keys(written)[0]},
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeOpenRequest reads back as valid and identical', () => {
    const written = writeOpenRequest({
      hostKey: 'Alias',
      path: '/w/a.code-workspace',
      kind: 'workspace',
      window: 'new',
    });
    deepStrictEqual(
      {result: readOpenRequest(written), firstKey: Object.keys(written)[0]},
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeActiveFoldersPush reads back as valid and identical', () => {
    const written = writeActiveFoldersPush({
      outcome: 'connected',
      hostKey: 'h',
      folders: ['/a', '/b'],
    });
    deepStrictEqual(
      {
        result: readActiveFoldersPush(written),
        firstKey: Object.keys(written)[0],
      },
      {result: {status: 'valid', value: written}, firstKey: 'interfaceVersion'},
    );
  });

  it('F-5902.5.rules: writeEnvelope writes the interface version alone', () => {
    deepStrictEqual(writeEnvelope(), {interfaceVersion: {major: 1, minor: 0}});
  });

  it('F-5902.5.rules: writeActiveRemote of a disconnected body has no host key property', () => {
    deepStrictEqual(writeActiveRemote({connected: false}), {
      interfaceVersion: {major: 1, minor: 0},
      connected: false,
    });
  });
});
