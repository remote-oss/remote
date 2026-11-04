import {deepStrictEqual} from 'node:assert';
import {
  type DaemonFigures,
  daemonFiguresOf,
  GPU_KEY,
  type HostRequirements,
  mergedRequirements,
  requirementsOf,
  requirementsOfLabel,
  requirementsOfText,
  unmetDetail,
} from '../../src/engine/host-requirements.ts';

const BYTES_PER_GIB = 1024 ** 3;
const DAEMON: DaemonFigures = {
  cpus: 4,
  memory: 16 * BYTES_PER_GIB,
  nvidia: false,
};

/** The detail of the dialog for requirements asked of a small daemon. */
function detailOf(
  required: Partial<HostRequirements>,
  daemon: DaemonFigures = DAEMON,
) {
  return unmetDetail(
    {needsGpu: false, ...required},
    daemon,
    template => template,
  );
}

describe('what a configuration asks of the daemon (card containers-202, F-0206)', () => {
  it('F-0206 AC-17, AC-29, AC-46: a memory is read from digits with a lowercase unit, from bytes as digits and from a number of bytes', () => {
    deepStrictEqual(
      [
        requirementsOf({memory: '65536mb'}).memory,
        requirementsOf({memory: '64gb'}).memory,
        requirementsOf({memory: '1tb'}).memory,
        requirementsOf({memory: '2048kb'}).memory,
        requirementsOf({memory: '68719476736'}).memory,
        requirementsOf({memory: 549755813888}).memory,
      ],
      [
        64 * BYTES_PER_GIB,
        64 * BYTES_PER_GIB,
        1024 ** 4,
        2048 * 1024,
        64 * BYTES_PER_GIB,
        512 * BYTES_PER_GIB,
      ],
    );
  });

  it('F-0206 AC-20: anything else is absent: not a number, an uppercase unit, a fraction, a unit alone, an object', () => {
    deepStrictEqual(
      [
        requirementsOf({cpus: 'not-a-number'}).cpus,
        requirementsOf({memory: '64GB'}).memory,
        requirementsOf({memory: '1.5gb'}).memory,
        requirementsOf({memory: 'gb'}).memory,
        requirementsOf({memory: {}}).memory,
        requirementsOf({cpus: Number.NaN}).cpus,
        requirementsOf({storage: Number.POSITIVE_INFINITY}).storage,
      ],
      [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('F-0206 AC-21, AC-47: the CPUs are read as written: a fraction, and a text that is a number', () => {
    deepStrictEqual(
      [requirementsOf({cpus: 4.5}).cpus, requirementsOf({cpus: '64'}).cpus],
      [4.5, 64],
    );
  });

  it('F-0206 AC-9, AC-10, AC-11: the GPU is required by true and by an object, and by nothing else', () => {
    deepStrictEqual(
      [true, 'optional', false, {cores: 2, memory: '1gb'}, null, undefined].map(
        setting => requirementsOf({[GPU_KEY]: setting}).needsGpu,
      ),
      [true, false, false, true, false, false],
    );
  });

  it('F-0206 AC-34: a member the format does not know is ignored, and a value that is no object asks nothing', () => {
    deepStrictEqual(
      [
        requirementsOf({cpus: 999, bogusExtraKey: 'x'}),
        requirementsOf('cpus'),
        requirementsOf(undefined),
        requirementsOf([1]),
      ],
      [
        {cpus: 999, needsGpu: false},
        {needsGpu: false},
        {needsGpu: false},
        {needsGpu: false},
      ],
    );
  });

  it('F-0206 BR-11a: a configuration’s text is read tolerantly: comments and a trailing comma, and a text that is no object asks nothing', () => {
    deepStrictEqual(
      [
        requirementsOfText(
          '{ // asks\n "hostRequirements": {"cpus": 16, "storage": "1gb",},\n}',
        ),
        requirementsOfText('[]'),
        requirementsOfText('{"image": "x"}'),
      ],
      [
        {cpus: 16, storage: BYTES_PER_GIB, needsGpu: false},
        {needsGpu: false},
        {needsGpu: false},
      ],
    );
  });

  it('F-0206 AC-24, AC-27, AC-36: a container’s label is read entry by entry and merged: the larger CPUs, memory and disk, and the GPU if any entry requires it', () => {
    deepStrictEqual(
      [
        requirementsOfLabel(
          JSON.stringify([
            {hostRequirements: {cpus: 16, memory: '8gb'}},
            {id: 'a-feature'},
            {hostRequirements: {cpus: 2, memory: '32gb', [GPU_KEY]: true}},
          ]),
        ),
        requirementsOfLabel(JSON.stringify({hostRequirements: {cpus: 3}})),
        requirementsOfLabel('not json'),
        requirementsOfLabel('[1, null]'),
      ],
      [
        {cpus: 16, memory: 32 * BYTES_PER_GIB, needsGpu: true},
        {cpus: 3, needsGpu: false},
        {needsGpu: false},
        {needsGpu: false},
      ],
    );
  });

  it('F-0206 BR-13: merging takes the larger of each and none of an absent one', () => {
    deepStrictEqual(
      [
        mergedRequirements([
          {cpus: 2, needsGpu: false},
          {memory: BYTES_PER_GIB, storage: 2 * BYTES_PER_GIB, needsGpu: false},
        ]),
        mergedRequirements([]),
      ],
      [
        {
          cpus: 2,
          memory: BYTES_PER_GIB,
          storage: 2 * BYTES_PER_GIB,
          needsGpu: false,
        },
        {needsGpu: false},
      ],
    );
  });
});

describe('the daemon’s figures and the dialog’s lines (card containers-202, F-0206)', () => {
  it('F-0206 BR-1, BR-2: the figures are the CPU count, the memory and whether the NVIDIA runtime is listed', () => {
    deepStrictEqual(
      [
        daemonFiguresOf(
          JSON.stringify({
            NCPU: 8,
            MemTotal: 1000,
            Runtimes: {runc: {}, nvidia: {}},
          }),
        ),
        daemonFiguresOf(
          JSON.stringify({NCPU: 2, MemTotal: 5, Runtimes: {runc: {}}}),
        ),
        daemonFiguresOf(JSON.stringify({NCPU: 2, MemTotal: 5})),
      ],
      [
        {cpus: 8, memory: 1000, nvidia: true},
        {cpus: 2, memory: 5, nvidia: false},
        {cpus: 2, memory: 5, nvidia: false},
      ],
    );
  });

  it('F-0206 BR-1: output that gives no CPU count and memory, or is no JSON object, gives no figures', () => {
    deepStrictEqual(
      [
        daemonFiguresOf('not json'),
        daemonFiguresOf('null'),
        daemonFiguresOf('{"NCPU":"4","MemTotal":1}'),
        daemonFiguresOf('{"NCPU":4}'),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('F-0206 AC-3, AC-16: unmet CPUs show the daemon’s CPUs and RAM, though the configuration asks for no memory', () => {
    deepStrictEqual(
      detailOf({cpus: 8}),
      'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 8',
    );
  });

  it('F-0206 AC-17: memory shows in gibibytes with one decimal: 64gb, and 68.4gb for 70000mb', () => {
    deepStrictEqual(
      [
        detailOf({memory: 64 * BYTES_PER_GIB}),
        detailOf({memory: 70000 * 1024 ** 2}),
      ],
      [
        'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: RAM 64gb',
        'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: RAM 68.4gb',
      ],
    );
  });

  it('F-0206 AC-18: the configuration lists CPUs, RAM, disk and GPU in that order, with disk and GPU never compared', () => {
    deepStrictEqual(
      detailOf({
        cpus: 16,
        memory: 64 * BYTES_PER_GIB,
        storage: 70000 * 1024 ** 2,
        needsGpu: true,
      }),
      'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 16, RAM 64gb, disk 68.4gb, GPU',
    );
  });

  it('F-0206 AC-35: a disk that is met is listed in the configuration’s part and the daemon’s part has no disk figure', () => {
    deepStrictEqual(
      detailOf({cpus: 8, storage: BYTES_PER_GIB}),
      'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 8, disk 1gb',
    );
  });

  it('F-0206 AC-21: a fraction of a CPU above the count is unmet and shown as written', () => {
    deepStrictEqual(
      detailOf({cpus: 4.5}),
      'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 4.5',
    );
  });

  it('F-0206 AC-7, AC-8, AC-28: a GPU asked for alone is no unmet requirement; neither are CPUs and memory that are met', () => {
    deepStrictEqual(
      [
        detailOf({needsGpu: true}),
        detailOf({
          cpus: 4,
          memory: 16 * BYTES_PER_GIB,
          storage: 100 * BYTES_PER_GIB,
        }),
        detailOf({}),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('F-0206 AC-40: a daemon that lists the NVIDIA runtime ends its part with GPU', () => {
    deepStrictEqual(
      detailOf({cpus: 8}, {...DAEMON, nvidia: true}),
      'Docker daemon: CPUs 4, RAM 16gb, GPU\ndevcontainer.json: CPUs 8',
    );
  });

  it('F-0206 AC-3: memory above the daemon’s is unmet by itself', () => {
    deepStrictEqual(
      detailOf({memory: 17 * BYTES_PER_GIB}),
      'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: RAM 17gb',
    );
  });
});
