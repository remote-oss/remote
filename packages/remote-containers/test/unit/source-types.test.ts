import {deepStrictEqual} from 'node:assert';
import {sourceTypesValid} from '../../src/config/source-types.ts';

describe('the source types of a configuration (card containers-57)', () => {
  it('F-0301 7.E3: an image that is a string is valid', () => {
    deepStrictEqual(sourceTypesValid({image: 'node:22'}), true);
  });

  it('F-0301 7.E3: a configuration without an image or Dockerfile is valid', () => {
    deepStrictEqual(sourceTypesValid({}), true);
  });

  it('F-0301 7.E3: an image that is a number, a boolean, an object or a list is invalid', () => {
    deepStrictEqual(
      [
        sourceTypesValid({image: 42}),
        sourceTypesValid({image: true}),
        sourceTypesValid({image: {}}),
        sourceTypesValid({image: ['a']}),
      ],
      [false, false, false, false],
    );
  });

  it('F-0301 7.E3: a dockerFile that is a number is invalid, and one that is a string is valid', () => {
    deepStrictEqual(
      [sourceTypesValid({dockerFile: 7}), sourceTypesValid({dockerFile: 'Dockerfile'})],
      [false, true],
    );
  });

  it('F-0301 7.E3: a build.dockerfile that is a number is invalid, and one that is a string is valid', () => {
    deepStrictEqual(
      [
        sourceTypesValid({build: {dockerfile: 7}}),
        sourceTypesValid({build: {dockerfile: 'Dockerfile'}}),
      ],
      [false, true],
    );
  });

  it('F-0301 7.E3: a build that is not an object is not checked', () => {
    deepStrictEqual(
      [
        sourceTypesValid({build: 'x'}),
        sourceTypesValid({build: null}),
        sourceTypesValid({build: ['x']}),
      ],
      [true, true, true],
    );
  });

  it('F-0301 7.E3: a service and a dockerComposeFile are not checked', () => {
    deepStrictEqual(sourceTypesValid({service: 5, dockerComposeFile: 6}), true);
  });
});
