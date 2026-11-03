import {deepStrictEqual} from 'node:assert';
import {composeScopeOf} from '../../src/compose/scope.ts';

describe('the services a Compose configuration starts (F-0413 BR-2)', () => {
  it('F-0413 AC-1: with no runServices the scope is the services the model lists', () => {
    deepStrictEqual(
      composeScopeOf({
        service: 'app',
        runServices: undefined,
        modelServices: ['app', 'db'],
      }),
      ['app', 'db'],
    );
  });

  it('F-0413 AC-1: an empty runServices names none, so the scope is the model’s too', () => {
    deepStrictEqual(
      composeScopeOf({
        service: 'app',
        runServices: [],
        modelServices: ['app', 'db'],
      }),
      ['app', 'db'],
    );
  });

  it('F-0413 AC-5: runServices that holds the primary service is the scope as written', () => {
    deepStrictEqual(
      composeScopeOf({
        service: 'app',
        runServices: ['app'],
        modelServices: ['app', 'db'],
      }),
      ['app'],
    );
  });

  it('F-0413 AC-70: runServices without the primary service gets it added at the end', () => {
    deepStrictEqual(
      composeScopeOf({
        service: 'app',
        runServices: ['db'],
        modelServices: ['db', 'tools'],
      }),
      ['db', 'app'],
    );
  });
});
