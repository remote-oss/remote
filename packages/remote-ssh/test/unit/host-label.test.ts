/**
 * @fileoverview The host label of an SSH window (card remote-ssh-03): the host text, a port after an IP address
 * literal, and the user never shown.
 */

import {deepStrictEqual} from 'node:assert';
import {hostLabel} from '../../src/window/host-label.ts';

describe('hostLabel', () => {
  it('{kind:"host", hostName:"my-alias"} is my-alias', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: 'my-alias'}),
      'my-alias',
    );
  });

  it('{kind:"host", hostName:"my-alias", port:22} is my-alias', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: 'my-alias', port: 22}),
      'my-alias',
    );
  });

  it('{kind:"host", hostName:"my-alias", user:"u", port:2222} is my-alias', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: 'my-alias', user: 'u', port: 2222}),
      'my-alias',
    );
  });

  it('{kind:"host", hostName:"192.0.2.10", user:"u"} is 192.0.2.10', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: '192.0.2.10', user: 'u'}),
      '192.0.2.10',
    );
  });

  it('{kind:"host", hostName:"192.0.2.10", user:"u", port:22} is 192.0.2.10:22', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: '192.0.2.10', user: 'u', port: 22}),
      '192.0.2.10:22',
    );
  });

  it('{kind:"host", hostName:"192.0.2.10", port:2222} is 192.0.2.10:2222', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: '192.0.2.10', port: 2222}),
      '192.0.2.10:2222',
    );
  });

  it('{kind:"host", hostName:"build.example.com", user:"u", port:2200} is build.example.com', () => {
    deepStrictEqual(
      hostLabel({
        kind: 'host',
        hostName: 'build.example.com',
        user: 'u',
        port: 2200,
      }),
      'build.example.com',
    );
  });

  it('{kind:"host", hostName:"2001:db8::1", user:"u", port:2222} is 2001:db8::1:2222', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: '2001:db8::1', user: 'u', port: 2222}),
      '2001:db8::1:2222',
    );
  });

  it('{kind:"host", hostName:"[2001:db8::1]", port:2222} is 2001:db8::1:2222', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: '[2001:db8::1]', port: 2222}),
      '2001:db8::1:2222',
    );
  });

  it('{kind:"host", hostName:"[2001:db8::1]"} is 2001:db8::1', () => {
    deepStrictEqual(
      hostLabel({kind: 'host', hostName: '[2001:db8::1]'}),
      '2001:db8::1',
    );
  });

  it('{kind:"plain", text:"anything typed"} is anything typed', () => {
    deepStrictEqual(
      hostLabel({kind: 'plain', text: 'anything typed'}),
      'anything typed',
    );
  });
});
