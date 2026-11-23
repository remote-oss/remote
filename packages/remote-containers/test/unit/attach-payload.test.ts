import {deepStrictEqual} from 'node:assert';
import {attachedPayloadOf, attachedTargetOf} from '../../src/attach/payload.ts';
import {attachedSuffixOf} from '../../src/attach/label.ts';

/** The hex of a JSON text. */
function hexOf(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex');
}

describe('the payload of an attached container (card containers-162, brief-attach §3)', () => {
  it('F-0601 BR-8: the payload is the hex of the container name alone for the default engine, and the engine members follow in their order', () => {
    deepStrictEqual(
      [
        attachedPayloadOf({containerName: '/web'}),
        attachedPayloadOf({
          containerName: '/web',
          tlsVerify: '1',
          certPath: '/c',
          host: 'tcp://h:2376',
          context: 'remote',
        }),
      ],
      [
        hexOf('{"containerName":"/web"}'),
        hexOf(
          '{"containerName":"/web","settings":{"context":"remote","host":"tcp://h:2376","certPath":"/c","tlsVerify":"1"}}',
        ),
      ],
    );
  });

  it('F-0601 BR-8: a WSL window’s working folder is the last member', () => {
    deepStrictEqual(
      attachedPayloadOf({
        containerName: '/web',
        context: 'c',
        cwd: '\\\\wsl.localhost\\Ubuntu',
      }),
      hexOf(
        '{"containerName":"/web","settings":{"context":"c"},"cwd":"\\\\\\\\wsl.localhost\\\\Ubuntu"}',
      ),
    );
  });

  it('F-0601 BR-8: every member comes back, and so does the bare name', () => {
    const full = {
      containerName: '/db_1',
      context: 'remote',
      host: 'ssh://u@h',
      certPath: '/certs',
      tlsVerify: '1',
      cwd: '\\\\wsl.localhost\\Ubuntu',
    };
    deepStrictEqual(
      [
        attachedTargetOf(attachedPayloadOf(full)),
        attachedTargetOf(attachedPayloadOf({containerName: '/web'})),
      ],
      [full, {containerName: '/web'}],
    );
  });

  it('F-0601 BR-8: a payload that is not hex, not JSON, or not a target is refused with the step that refused it', () => {
    deepStrictEqual(
      [
        'xyz',
        '',
        'abc',
        hexOf('{not json'),
        hexOf('[]'),
        hexOf('{}'),
        hexOf('{"containerName":"web"}'),
        hexOf('{"containerName":"/"}'),
        hexOf('{"containerName":3}'),
        hexOf('{"containerName":"/w","settings":3}'),
        hexOf('{"containerName":"/w","settings":{}}'),
        hexOf('{"containerName":"/w","settings":{"context":""}}'),
        hexOf('{"containerName":"/w","settings":{"host":3}}'),
        hexOf('{"containerName":"/w","cwd":""}'),
        hexOf('{"containerName":"/w","cwd":3}'),
      ].map(attachedTargetOf),
      [
        {malformed: 'hex'},
        {malformed: 'hex'},
        {malformed: 'hex'},
        {malformed: 'json'},
        ...Array.from({length: 11}, () => ({malformed: 'shape'})),
      ],
    );
  });

  it('F-0205 AC-45, F-0601 AC-44: the label names the image and the container, with the context or the host after it, and is the bare word when the container is not found', () => {
    const identity = {image: 'nginx:1', name: 'web'};
    deepStrictEqual(
      [
        attachedSuffixOf(identity, {}, template => template),
        attachedSuffixOf(identity, {context: 'remote'}, template => template),
        attachedSuffixOf(
          identity,
          {context: 'remote', host: 'tcp://h:2376'},
          template => template,
        ),
        attachedSuffixOf(undefined, {context: 'remote'}, template => template),
      ],
      [
        'Container nginx:1 (web)',
        'Container nginx:1 (web) @ remote',
        'Container nginx:1 (web) @ tcp://h:2376',
        'Container',
      ],
    );
  });
});
