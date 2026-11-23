import type {Scheduler} from 'lib-helper';
import type {SocksProbe} from '../../src/index.ts';

/** How a scripted probe answers: at once, or with the silence of a frozen session until the request's deadline. */
export interface ProbeScript {
  answers: boolean;
}

/** A probe that answers as `script` says, its deadline kept by `scheduler`, and that records the requests it got. */
export function scriptedProbe(
  scheduler: Scheduler,
  script: ProbeScript = {answers: true},
  requests: Array<Parameters<SocksProbe>[0]> = [],
): SocksProbe {
  return request => {
    requests.push(request);
    return script.answers
      ? Promise.resolve(true)
      : new Promise(resolve => {
          scheduler.setTimer(request.deadlineMilliseconds, () => {
            resolve(false);
          });
        });
  };
}
