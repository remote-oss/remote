import {deepStrictEqual} from 'node:assert';
import {linkedAbort} from '../../src/linked-abort.ts';

describe('the linked abort', () => {
  it('its own signal is aborted when the one it follows is', () => {
    const cancellation = new AbortController();
    const {own} = linkedAbort(cancellation.signal);
    cancellation.abort();
    deepStrictEqual(own.signal.aborted, true);
  });

  it('its own signal is aborted at once when the one it follows already is', () => {
    const cancellation = new AbortController();
    cancellation.abort();
    deepStrictEqual(linkedAbort(cancellation.signal).own.signal.aborted, true);
  });

  it('it can be aborted on its own, and the one it follows is not', () => {
    const cancellation = new AbortController();
    const {own} = linkedAbort(cancellation.signal);
    own.abort();
    deepStrictEqual(cancellation.signal.aborted, false);
  });

  it('after release, an abort of the one it followed no longer reaches it', () => {
    const cancellation = new AbortController();
    const {own, release} = linkedAbort(cancellation.signal);
    release();
    cancellation.abort();
    deepStrictEqual(own.signal.aborted, false);
  });
});
