import {deepStrictEqual} from 'node:assert';
import {LINUX_PREREQUISITES_TOPIC} from 'lib-ssh';
import {
  OLD_LINUX_PAGE,
  prerequisitesHint,
} from '../../src/diagnostics/prerequisites-hint.ts';
import {ownText} from '../../src/surfaces/own-strings.ts';

describe('the hint of a host that does not meet the server’s prerequisites (card #2879)', () => {
  const hint = prerequisitesHint();

  it('F-2401 AC-22: the status is LinuxPrereqs, the message is STR:S145 and the details are STR:S144', () => {
    deepStrictEqual(
      [
        hint.status,
        typeof hint.message === 'string'
          ? hint.message
          : ownText(hint.message, template => template),
        hint.details,
      ],
      [
        'LinuxPrereqs',
        "The remote host may not meet VS Code Server's prerequisites for glibc and libstdc++",
        {id: 'S144'},
      ],
    );
  });

  it('F-2401 AC-22: the one mitigation is the reimplementation’s own page on old Linux hosts, never Microsoft’s short link', () => {
    deepStrictEqual(
      [
        hint.mitigations.map(each => ownText(each, template => template)),
        OLD_LINUX_PAGE.includes('aka.ms'),
      ],
      [[OLD_LINUX_PAGE], false],
    );
  });

  it('F-2401 AC-22: the one resource is the topic of the page on Linux prerequisites', () => {
    deepStrictEqual(hint.resources, [LINUX_PREREQUISITES_TOPIC]);
  });
});
