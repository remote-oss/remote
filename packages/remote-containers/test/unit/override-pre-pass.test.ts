import {deepStrictEqual} from 'node:assert';
import {dropsImage, overrideText} from '../../src/cli/override-pre-pass.ts';

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

  /** The override parsed back to an object. */
  function parsedOverride(
    text: string,
    environment: Record<string, string> = {},
  ): unknown {
    const override = overrideText(text, environment);
    return override === undefined ? undefined : JSON.parse(override);
  }

  it('F-0412 7.E8, Q-1: image beside a build object is dropped', () => {
    deepStrictEqual(
      parsedOverride(
        '{"image":"alpine:3.22","build":{"dockerfile":"Dockerfile"}}',
      ),
      {build: {dockerfile: 'Dockerfile'}},
    );
  });

  it('F-0412 7.E8: image beside the legacy dockerFile is dropped', () => {
    deepStrictEqual(parsedOverride('{"image":"a","dockerFile":"Dockerfile"}'), {
      dockerFile: 'Dockerfile',
    });
  });

  it('F-0412 BR-16: image alone is untouched', () => {
    deepStrictEqual(overrideText('{"image":"a"}', {}), undefined);
  });

  it('F-0412: a build without image is untouched', () => {
    deepStrictEqual(
      overrideText('{"build":{"dockerfile":"D"}}', {}),
      undefined,
    );
  });

  it("F-0412: an image inside build isn't the top-level one", () => {
    deepStrictEqual(
      overrideText('{"build":{"dockerfile":"D","image":"x"}}', {}),
      undefined,
    );
  });

  it("F-0412: a build that isn't an object doesn't count", () => {
    deepStrictEqual(
      [
        overrideText('{"image":"a","build":"D"}', {}),
        overrideText('{"image":"a","build":["D"]}', {}),
        overrideText('{"image":"a","dockerFile":3}', {}),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('F-0412: a configuration that is not an object has nothing to drop', () => {
    deepStrictEqual(
      [overrideText('["image"]', {}), overrideText('"image"', {})],
      [undefined, undefined],
    );
  });

  it('ADR-0009: comments and other members stay when the image goes', () => {
    deepStrictEqual(
      overrideText(
        '{\n  // the image\n  "image": "a",\n  "name": "n",\n  "dockerFile": "D"\n}',
        {},
      )?.includes('"name": "n"'),
      true,
    );
  });

  it('ADR-0009: a comment above another member stays when the image goes', () => {
    deepStrictEqual(
      overrideText(
        '{\n  // keep\n  "name": "n",\n  "image": "a",\n  "dockerFile": "D"\n}',
        {},
      ),
      '{\n  // keep\n  "name": "n",\n  "dockerFile": "D"\n}',
    );
  });

  it('ADR-0009: this rule and an env rule apply together', () => {
    deepStrictEqual(
      parsedOverride(
        '{"image":"${localEnv:EMPTY_VARIABLE:fallback}","name":"${localEnv:EMPTY_VARIABLE:fallback}","build":{"dockerfile":"D"}}',
        {EMPTY_VARIABLE: ''},
      ),
      {name: 'fallback', build: {dockerfile: 'D'}},
    );
  });

  it('F-0412 Q-1: dropsImage says whether the rule applies', () => {
    deepStrictEqual(
      [
        dropsImage('{"image":"a","dockerFile":"D"}'),
        dropsImage('{"image":"a"}'),
        dropsImage('{"image":'),
      ],
      [true, false, false],
    );
  });
});
