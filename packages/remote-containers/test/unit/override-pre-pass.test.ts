import {deepStrictEqual} from 'node:assert';
import {overrideText} from '../../src/cli/override-pre-pass.ts';

describe('the override pre-pass (card containers-04)', () => {
  it('F-0304 AC-66: a localEnv reference to an empty variable gets its default', () => {
    deepStrictEqual(
      overrideText('{"name": "${localEnv:V:dflt}"}', {V: ''}),
      '{"name": "dflt"}',
    );
  });

  it('F-0304 AC-66: an env reference to an empty variable gets its default', () => {
    deepStrictEqual(
      overrideText('{"name": "${env:V:dflt}"}', {V: ''}),
      '{"name": "dflt"}',
    );
  });

  it('C3: a variable that is unset, set to something, or referenced without a default changes nothing', () => {
    deepStrictEqual(
      [
        overrideText('{"name": "${localEnv:V:dflt}"}', {}),
        overrideText('{"name": "${localEnv:V:dflt}"}', {V: 'x'}),
        overrideText('{"name": "${localEnv:V}"}', {V: ''}),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('C3: a default with a colon inside is the next piece only, as the CLI reads it', () => {
    deepStrictEqual(
      overrideText('{"name": "${localEnv:V:a:b}"}', {V: ''}),
      '{"name": "a"}',
    );
  });

  it('C3: a default that is empty replaces the reference with nothing', () => {
    deepStrictEqual(
      overrideText('{"name": "x${localEnv:V:}y"}', {V: ''}),
      '{"name": "xy"}',
    );
  });

  it('C3: a containerEnv reference is left alone', () => {
    deepStrictEqual(
      overrideText('{"name": "${containerEnv:PATH:x}"}', {PATH: ''}),
      undefined,
    );
  });

  it('C3: every string value is rewritten, in objects and arrays, and keys are not', () => {
    deepStrictEqual(
      overrideText(
        '{"${localEnv:K:key}": ["${localEnv:V:a}", {"n": "${localEnv:V:b}"}], "m": 1}',
        {V: '', K: ''},
      ),
      '{"${localEnv:K:key}": ["a", {"n": "b"}], "m": 1}',
    );
  });

  it('C3: comments and trailing commas survive', () => {
    const text = '{\n  // the name\n  "name": "${localEnv:V:dflt}",\n}\n';
    deepStrictEqual(
      overrideText(text, {V: ''}),
      '{\n  // the name\n  "name": "dflt",\n}\n',
    );
  });

  it('C3: a text that does not parse gives nothing, for the CLI to read', () => {
    deepStrictEqual(
      overrideText('{"name": "${localEnv:V:dflt}", ', {V: ''}),
      undefined,
    );
  });

  it('C3: a text with nothing in it gives nothing', () => {
    deepStrictEqual(overrideText('', {V: ''}), undefined);
  });
});
