import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  reloadingCommand,
  variable,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {docker} from './resolve-support.ts';

/** The tag and id of one image object. */
interface ImageObject {
  reference: string;
  imageId: string;
}

/** The image objects whose repository starts with `prefix`, sorted by tag. */
async function imagesOf(prefix: string): Promise<ImageObject[]> {
  return (
    await docker(
      'images',
      '--no-trunc',
      '--format',
      '{{.Repository}}:{{.Tag}}|{{.ID}}',
    )
  )
    .split('\n')
    .filter(line => line.startsWith(prefix))
    .map(line => {
      const [reference = '', imageId = ''] = line.split('|');
      return {reference, imageId};
    })
    .sort((left, right) => (left.reference < right.reference ? -1 : 1));
}

/** The ids of the dangling images. */
async function danglingImages(): Promise<string[]> {
  return (
    await docker('images', '--filter', 'dangling=true', '--quiet', '--no-trunc')
  )
    .split('\n')
    .filter(line => line !== '')
    .sort();
}

/** Whether Docker still has an image object with the id `id`. */
async function exists(imageId: string): Promise<boolean> {
  return docker('image', 'inspect', '-f', '{{.Id}}', imageId).then(
    () => true,
    () => false,
  );
}

/** The mtime in seconds of `file` in the container of `folder`. */
async function mtimeOf(folder: string, file: string): Promise<number> {
  const [container = ''] = await devContainersOf(folder);
  return Number(await docker('exec', container, 'stat', '-c', '%Y', file));
}

/** A base image the run's registry holds, so that a build that pulls finds it; its name. */
async function pushedBase(label: string): Promise<string> {
  const base = `${variable('HARNESS_REGISTRY')}/c67-base-${label}:${String(Date.now())}`;
  await docker('tag', variable('HARNESS_DEVCONTAINER_IMAGE'), base);
  await docker('push', base);
  return base;
}

describe('F-0405 the rebuild of the images (card coverage-67)', function () {
  this.timeout(900_000);

  it('F-0405 AC-7 (c67-dockerfile): Rebuild Container re-points both images and reuses the cached steps; Rebuild Container Without Cache re-executes every step; neither leaves a dangling image or the previous objects', async () => {
    const base = await pushedBase('dockerfile');
    const folder = devContainerFolder('c67-rebuild-dockerfile', {
      name: 'Rebuild Images',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
      remoteUser: 'node',
    });
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${base}\nRUN date +%s > /c67-marker\n`,
    );
    const prefix = 'vsc-c67-rebuild-dockerfile';
    const danglingBefore = await danglingImages();
    const name = await openFolderWindow(folder);
    try {
      await reloadingCommand(name, 'remote-containers.reopenInContainer');
      await connectedToContainer(name);
      const first = {
        images: await imagesOf(prefix),
        marker: await mtimeOf(folder, '/c67-marker'),
      };
      await new Promise(resolve => setTimeout(resolve, 3000));
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      await connectedToContainer(name);
      const cached = {
        images: await imagesOf(prefix),
        marker: await mtimeOf(folder, '/c67-marker'),
      };
      await new Promise(resolve => setTimeout(resolve, 3000));
      const before = Math.floor(Date.now() / 1000);
      await reloadingCommand(name, 'remote-containers.rebuildContainerNoCache');
      await connectedToContainer(name);
      const uncached = {
        images: await imagesOf(prefix),
        marker: await mtimeOf(folder, '/c67-marker'),
      };
      const after = Math.floor(Date.now() / 1000);
      function repointed(
        previous: readonly ImageObject[],
        next: readonly ImageObject[],
      ): boolean {
        return (
          JSON.stringify(next.map(image => image.reference)) ===
            JSON.stringify(previous.map(image => image.reference)) &&
          next.every(
            image =>
              !previous.some(earlier => earlier.imageId === image.imageId),
          )
        );
      }
      deepStrictEqual(
        {
          twoImages: first.images.length,
          cachedRepointed: repointed(first.images, cached.images),
          cachedMarkerKept: cached.marker === first.marker,
          uncachedRepointed: repointed(cached.images, uncached.images),
          uncachedMarkerAtRebuild:
            uncached.marker >= before && uncached.marker <= after,
          previousPruned: await Promise.all(
            [...first.images, ...cached.images].map(image =>
              exists(image.imageId),
            ),
          ),
          dangling: await danglingImages(),
        },
        {
          twoImages: 2,
          cachedRepointed: true,
          cachedMarkerKept: true,
          uncachedRepointed: true,
          uncachedMarkerAtRebuild: true,
          previousPruned: [false, false, false, false],
          dangling: danglingBefore,
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
      for (const image of await imagesOf(prefix)) {
        await docker('image', 'rm', '--force', image.imageId).catch(
          () => undefined,
        );
      }
      await docker('image', 'rm', '--force', base).catch(() => undefined);
    }
  });

  it('F-0405 AC-7 (c67-image): with an image configuration Rebuild Container Without Cache does not pull the source image again, keeps the -uid tag and replaces the container as the cached variant does', async () => {
    const base = await pushedBase('image');
    const folder = devContainerFolder('c67-rebuild-image', {
      name: 'Rebuild Image',
      image: base,
      remoteUser: 'node',
    });
    const prefix = 'vsc-c67-rebuild-image';
    const name = await openFolderWindow(folder);
    try {
      await reloadingCommand(name, 'remote-containers.reopenInContainer');
      await connectedToContainer(name);
      const sourceId = await docker('image', 'inspect', '-f', '{{.Id}}', base);
      const first = await imagesOf(prefix);
      const [firstContainer = ''] = await devContainersOf(folder);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      await connectedToContainer(name);
      const cached = await imagesOf(prefix);
      const [cachedContainer = ''] = await devContainersOf(folder);
      await new Promise(resolve => setTimeout(resolve, 3000));
      const mark = containersLog().length;
      await reloadingCommand(name, 'remote-containers.rebuildContainerNoCache');
      await connectedToContainer(name);
      const uncached = await imagesOf(prefix);
      const [uncachedContainer = ''] = await devContainersOf(folder);
      deepStrictEqual(
        {
          uidImages: [first, cached, uncached].map(each =>
            each.map(image => image.reference.endsWith('-uid:latest')),
          ),
          sameTag: new Set(
            [first, cached, uncached].map(each => each[0]?.reference),
          ).size,
          sourceUnchanged:
            (await docker('image', 'inspect', '-f', '{{.Id}}', base)) ===
            sourceId,
          pulled: containersLogSince(mark).some(line =>
            line.includes('Pulling from'),
          ),
          replaced: [
            firstContainer !== cachedContainer,
            cachedContainer !== uncachedContainer,
          ],
          oneContainer: (await devContainersOf(folder)).length,
        },
        {
          uidImages: [[true], [true], [true]],
          sameTag: 1,
          sourceUnchanged: true,
          pulled: false,
          replaced: [true, true],
          oneContainer: 1,
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
      for (const image of await imagesOf(prefix)) {
        await docker('image', 'rm', '--force', image.imageId).catch(
          () => undefined,
        );
      }
      await docker('image', 'rm', '--force', base).catch(() => undefined);
    }
  });
});
