import {deepStrictEqual} from 'node:assert';
import {decodeAuthority, type OpenOutcome} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {k8sTargetOf} from '../../src/attach/k8s-payload.ts';
import {k8sPickKeyOf} from '../../src/attach/k8s-pick-record.ts';
import {k8sWindowOpenerOf} from '../../src/attach/k8s-window.ts';

const SELECTION = {
  context: 'kind-lab',
  namespace: 'default',
  podName: 'web-1',
  container: {name: 'app', image: 'nginx:1.27'},
};

/** The opener over fakes that record what happened, in order. */
function openerOver(outcome: OpenOutcome) {
  const events: string[] = [];
  const sink = new MemorySink();
  const opener = k8sWindowOpenerOf({
    registerLabel: (decoded, suffix) => {
      events.push(`label ${decoded.family} ${suffix}`);
    },
    recordPick: key => {
      events.push(`pick ${key}`);
      return Promise.resolve();
    },
    openWindow: authority => {
      events.push(`open ${authority}`);
      return Promise.resolve(outcome);
    },
    translate: template => template,
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  });
  return {events, opener, lines: () => sink.lines.map(line => line.message)};
}

describe('the window of a picked pod container (card containers-191, part B)', () => {
  it('F-0604 AC-9, AC-10, AC-35: the label is registered and the pick recorded before the new window opens on the authority that names the pod', async () => {
    const seen = openerOver({kind: 'opened'});
    await seen.opener(SELECTION);
    const opened = seen.events.at(-1)?.replace('open ', '') ?? '';
    const decoded = decodeAuthority(opened);
    const payload =
      'malformed' in decoded || !('payload' in decoded.target)
        ? ''
        : decoded.target.payload;
    deepStrictEqual(
      [
        seen.events.slice(0, 2),
        'malformed' in decoded ? 'malformed' : decoded.family,
        k8sTargetOf(payload),
      ],
      [
        [
          'label k8s-container app in web-1 (nginx:1.27)',
          `pick ${k8sPickKeyOf({
            context: 'kind-lab',
            podname: 'web-1',
            namespace: 'default',
            name: 'app',
            image: 'nginx:1.27',
          })}`,
        ],
        'k8s-container',
        {
          context: 'kind-lab',
          podname: 'web-1',
          namespace: 'default',
          name: 'app',
          image: 'nginx:1.27',
        },
      ],
    );
  });

  it('F-0604 AC-9: a window the editor refuses is logged with its reason', async () => {
    const seen = openerOver({kind: 'rejected', reason: 'no window'});
    await seen.opener(SELECTION);
    deepStrictEqual(seen.lines(), [
      'Attach to Running Kubernetes Container was refused: no window',
    ]);
  });
});
