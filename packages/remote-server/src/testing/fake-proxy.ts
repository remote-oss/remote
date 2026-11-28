/**
 * @fileoverview A local proxy for rows: a lease whose answers the row scripts, whose streams are in-process pairs the
 * row holds the far end of, and which records what it was asked. No bundle imports this module.
 */

import {Duplex, PassThrough} from 'node:stream';
import type {PlainData} from 'lib-helper';
import type {OpenOutcome, ProxyLease} from '../proxy/lease.ts';
import type {OpenFailureReason} from '../proxy/messages.ts';

/** The far end of an opened stream: what the window wrote, and the way to answer it. */
export interface FarEnd {
  tunnelName: string;
  port: number;
  /** The bytes the window wrote, from the far end's side. */
  received: PassThrough;
  /** What the row writes here, the window reads. */
  send: PassThrough;
}

/** How the fake answers `open` for a tunnel and port: a stream, or a failure. */
export type OpenScript = (
  tunnelName: string,
  port: number,
) => 'open' | {reason: OpenFailureReason; detail: string};

/** A scripted local proxy. */
export class FakeProxy implements ProxyLease {
  /** Every stream the window opened, in order. */
  readonly opened: FarEnd[] = [];
  /** The `serve` results kept, by tunnel name. */
  readonly kept = new Map<string, PlainData>();
  /** How many times the lease was given back. */
  releases = 0;
  private readonly script: OpenScript;

  /** A proxy that answers `open` as `script` says, by default with a stream for every port. */
  constructor(script: OpenScript = () => 'open') {
    this.script = script;
  }

  /** A stream whose far end the row holds, or the failure the script gives. */
  open(tunnelName: string, port: number): Promise<OpenOutcome> {
    const answer = this.script(tunnelName, port);
    if (answer !== 'open') {
      return Promise.resolve({kind: 'failed', ...answer});
    }
    const received = new PassThrough();
    const send = new PassThrough();
    const stream = Duplex.from({readable: send, writable: received});
    this.opened.push({tunnelName, port, received, send});
    return Promise.resolve({kind: 'opened', stream});
  }

  /** The kept result of `tunnelName`, or null. */
  serveKept(tunnelName: string): Promise<PlainData | null> {
    return Promise.resolve(this.kept.get(tunnelName) ?? null);
  }

  /** Keeps the first result of `tunnelName` and refuses a later one. */
  keepServe(tunnelName: string, served: PlainData): Promise<boolean> {
    if (this.kept.has(tunnelName)) {
      return Promise.resolve(false);
    }
    this.kept.set(tunnelName, served);
    return Promise.resolve(true);
  }

  /** Counts the release. */
  release(): void {
    this.releases += 1;
  }
}
