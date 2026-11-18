import {HOME, ownPathsOf, visit} from '../windows/explorer-folders.ts';
import {HOST_B as HOST} from './folders-support.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('measure: does a folder visited in a row leave the history before the next visit is read? (card #2757)', function () {
  this.timeout(1_800_000);

  it('20 rounds of three visits, the history of the round read after each visit and 3 s later', async () => {
    const lost: string[] = [];
    for (let round = 0; round < 20; round += 1) {
      const scope = `${HOME}/m2757-r${String(round)}-`;
      const names = ['a', 'b', 'c'].map(
        each => `m2757-r${String(round)}-${each}`,
      );
      for (const [index, name] of names.entries()) {
        await visit(HOST, name);
        const at = await ownPathsOf(HOST, scope);
        await sleep(3000);
        const later = await ownPathsOf(HOST, scope);
        const expected = names
          .slice(0, index + 1)
          .map(each => `${HOME}/${each}`)
          .reverse();
        if (
          JSON.stringify(at) !== JSON.stringify(expected) ||
          JSON.stringify(later) !== JSON.stringify(expected)
        ) {
          lost.push(
            `round ${String(round)} after ${name}: right after ${JSON.stringify(at)}, 3 s later ${JSON.stringify(later)}, expected ${JSON.stringify(expected)}`,
          );
        }
      }
    }
    console.log(
      `measure 2757: ${String(lost.length)} visits where the history was not as expected`,
    );
    console.log(lost.join('\n'));
  });
});
