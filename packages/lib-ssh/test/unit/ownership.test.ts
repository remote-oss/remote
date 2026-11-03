import {deepStrictEqual} from 'node:assert';
import {LoginOwnership} from '../../src/index.ts';

describe('login ownership (F-2102 BR-4, BR-5)', () => {
  let changes: number[];
  let ownership: LoginOwnership;

  beforeEach(() => {
    changes = [];
    ownership = new LoginOwnership(owner => changes.push(owner));
  });

  it('gives the login to the first lease', () => {
    ownership.leasesChanged([1]);
    deepStrictEqual([ownership.current(), changes], [1, [1]]);
  });

  it('keeps the owner when later leases arrive, and lists them as waiting, oldest first', () => {
    ownership.leasesChanged([1]);
    ownership.leasesChanged([1, 2, 3]);
    deepStrictEqual(
      [ownership.current(), ownership.waiting(), changes],
      [1, [2, 3], [1]],
    );
  });

  it('hands the login to the oldest waiting lease when the owner closes', () => {
    ownership.leasesChanged([1, 2, 3]);
    ownership.leasesChanged([2, 3]);
    deepStrictEqual([ownership.current(), changes], [2, [1, 2]]);
  });

  it('F-2102 AC-36: a waiting lease that closes changes nothing: the owner stays, and no one is told', () => {
    ownership.leasesChanged([1, 2]);
    ownership.leasesChanged([1]);
    deepStrictEqual(
      [ownership.current(), ownership.waiting(), changes],
      [1, [], [1]],
    );
  });

  it('has no owner when the last lease closes, and the next lease takes the login', () => {
    ownership.leasesChanged([1]);
    ownership.leasesChanged([]);
    const afterLast = ownership.current();
    ownership.leasesChanged([4]);
    deepStrictEqual(
      [afterLast, ownership.current(), changes],
      [undefined, 4, [1, 4]],
    );
  });

  it('hands the login on when the owner gives up, while its lease stays', () => {
    ownership.leasesChanged([1, 2]);
    ownership.ownerGaveUp();
    deepStrictEqual(
      [ownership.current(), ownership.waiting(), changes],
      [2, [1], [1, 2]],
    );
  });

  it('does not give the login back to a lease that gave up when it is the only one left', () => {
    ownership.leasesChanged([1]);
    ownership.ownerGaveUp();
    deepStrictEqual([ownership.current(), changes], [undefined, [1]]);
  });

  it('forgets that a lease gave up once it has closed', () => {
    ownership.leasesChanged([1, 2]);
    ownership.ownerGaveUp();
    ownership.leasesChanged([2]);
    ownership.leasesChanged([2, 5]);
    ownership.ownerGaveUp();
    deepStrictEqual(ownership.current(), 5);
  });

  it('is told nothing when giving up with no owner', () => {
    ownership.ownerGaveUp();
    deepStrictEqual([ownership.current(), changes], [undefined, []]);
  });

  it('stops changing owners once the login is over', () => {
    ownership.leasesChanged([1, 2]);
    ownership.finish();
    ownership.leasesChanged([2]);
    deepStrictEqual([ownership.current(), changes], [1, [1]]);
  });

  it('copies the lease list it is given, so a later change of the array changes nothing', () => {
    const leaseIds = [1, 2];
    ownership.leasesChanged(leaseIds);
    leaseIds.shift();
    deepStrictEqual([ownership.waiting(), ownership.current()], [[2], 1]);
  });
});
