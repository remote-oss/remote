/**
 * @fileoverview A port prober for tests: it answers from a map of ports, and records the probed ports in order.
 */
import type {PortProber, ProbeAnswer} from '../port-search/find.ts';

/** The port prober tests hand to findFreePort: the map's answer, or open, with every probed port recorded. */
export class FakeProber implements PortProber {
  private readonly answers: Map<number, ProbeAnswer>;
  private readonly probedPorts: number[] = [];

  /** The map of ports to answers; a port absent from it answers open. */
  constructor(answers: Record<number, ProbeAnswer>) {
    this.answers = new Map(
      Object.entries(answers).map(([port, answer]) => [Number(port), answer]),
    );
  }

  /** The answer for a port, recorded in order; an unlisted port is open. */
  probe(port: number): Promise<ProbeAnswer> {
    this.probedPorts.push(port);
    return Promise.resolve(this.answers.get(port) ?? 'open');
  }

  /** The probed ports, in order. */
  get probed(): readonly number[] {
    return this.probedPorts;
  }
}
