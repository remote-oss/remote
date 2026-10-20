# Task card containers-59: a registry of the run, for F-0412's cacheFrom rows (AC-13, AC-15)

Issue: #1157. Milestone 0.4, containers release 1. Size: M. Builder: `task:claude`. Decision: daedalus, on athena's review of #1150
(F-0412 AC-13 and AC-15 "need a registry; no row pulls from one"). The registry is local to the run: no row pushes
to or pulls from a public registry beyond the image it starts. **Depends on #1145** (triton, containers-37: the
harness reads the Dev Containers log through `containersLogSince`) **and #1150** (dike, containers-52: F-0412's
rows). Start once both are merged.

Spec: remote-oss/remote-containers#29 (F-0412):
- **AC-13:** "Given an image built with no `cacheFrom`/`options`, pushed to a registry and named in a later
  `build.cacheFrom`, when that build runs, then the cache import from it succeeds." *(6.3, BR-12)*
- **AC-15:** "Given `build.cacheFrom` names a registry-hosted image, when the build runs, then its cache import
  reports no failure and the build completes." *(6.3, BR-8)*

## 1. Harness: the run's registry (`tools/`)

- **New `tools/acceptance-registry.ts`:** `startRunRegistry(command, runId): {address: string; stop(): void}`.
  - It runs `docker run -d --label <the run label, as runLabelArguments gives it> -p 127.0.0.1::5000 registry:2.8.3`.
    Pin the tag, and also the digest (`registry:2.8.3@sha256:…`), taken from `docker pull` on the day; put it in a
    constant with a comment saying where it came from.
  - It reads the published port with `docker port <id> 5000/tcp`, waits until `GET http://127.0.0.1:<port>/v2/`
    answers 200 (a bounded poll of at most 30 s, failing with a message that names the registry), and gives
    `address: '127.0.0.1:<port>'`.
  - `stop` runs `docker rm -f <id>`. The run's stale sweep (`sweepStaleDevContainers`, or its sibling for
    labelled containers) must also remove a registry a killed run left. Check that it does, and extend it if not.
- **Only when a chosen launch needs it:**
  - `LaunchCommon` gains `/** Whether the run starts its registry for this launch. */ registry?: true;`, and
    the `containers` launch gets `registry: true`.
  - `prepare` starts the registry once when a chosen launch has it, and pushes `stop` to `stops`.
  - `HarnessVariables` gains `HARNESS_REGISTRY?: string` (the address).
  - A run that makes no such launch never starts one.
- **Unit rows** (`tools/acceptance-registry.test.ts`, over a recording command runner, after the pattern of
  `acceptance-run.test.ts`): the `docker run` arguments, labels included; the port read; a `/v2/` that never answers
  fails naming the registry; `stop` removes it. In `tools/acceptance.test.ts`: a run whose chosen launches have no
  `registry` starts none; a run with `containers` starts one and passes `HARNESS_REGISTRY`. In
  `tools/acceptance-launches.test.ts`: only `containers` has `registry`.

## 2. Measure before the rows

The dev container CLI builds with `docker buildx build`. Run these by hand against the registry, on the runner's
Docker with its default builder, and put the outputs in the PR:
1. **Push.** `docker build -t 127.0.0.1:<port>/f0412-base:1 <dir>` with a two-step Dockerfile, then
   `docker push 127.0.0.1:<port>/f0412-base:1`. A `127.0.0.1` registry counts as insecure-allowed by default; if the
   push is refused, stop and report it.
2. **Import.** A dev container whose `build.dockerfile` is that Dockerfile and whose `build.cacheFrom` names the
   pushed image: what does the build's output say about the cache import (`importing cache manifest from …`, any
   `failed to …`), and where does it reach our log (`containersLogSince`)?
3. **AC-13's "succeeds".** An image built with no cache export has no cache metadata. Does the import then report
   success, or a skip, with BuildKit's default driver? Whatever it says, the row asserts exactly that text, and the
   PR quotes it.

## 3. Rows (`tests/acceptance/containers/`, in the file #1150 put F-0412's rows in)

- **`F-0412 AC-13 (cache-plain)`:** push an image built with plain `docker build` (§2.1). A dev container whose
  `build.cacheFrom` names it connects. `containersLogSince(mark)` has the import line §2.3 measured, and no line
  with `failed` about the cache.
- **`F-0412 AC-15 (cache-registry)`:** a dev container whose `build.cacheFrom` names a registry-hosted image (the
  pushed one, by `HARNESS_REGISTRY`) connects. The log has no cache-import failure, and the container is running.
- Each row removes its images (`docker rmi`) and its dev container in `finally`. The registry goes at the end of the
  run.

If §2 shows the product's build never names the `cacheFrom` image to BuildKit (no import line at all), the rows
can't pass: stop and tell me with the CLI arguments it ran. That would be a product question, not a harness one.

## 4. Coverage, README, done

- `docs/architecture/catalogue/coverage-containers-r1.tsv`: F-0412 AC-13 and AC-15 go from `todo` to `acceptance`.
  `check-coverage` passes.
- `tests/acceptance/README.md`: a short "The run's registry" section saying what starts it, its address variable,
  the pinned image and its cleanup.
- Done when the tools tests, the whole diff linted, `jscpd`, `knip` and
  `node tools/acceptance.ts --editor vscodium --launches containers` (the two rows and the launch's others) pass.
- PR title: `acceptance harness: a registry of the run, and F-0412's cacheFrom rows (card containers-59, #1157)`.
  Request athena only.
