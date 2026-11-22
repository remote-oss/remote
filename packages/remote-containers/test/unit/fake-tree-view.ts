/** What a fake tree view records. */
interface TreeViewScene {
  visibility: Array<(visible: boolean) => void>;
  disposed: string[];
}

/** The tree view the editor makes for a view, recording its visibility listeners and its disposals as `name`. */
export function fakeTreeView(
  scene: TreeViewScene,
  name: string,
  disposing: () => void = () => undefined,
) {
  return {
    onDidChangeVisibility: (listener: (visible: boolean) => void) => {
      scene.visibility.push(listener);
      return {
        dispose: () => {
          scene.disposed.push('visibility');
        },
      };
    },
    dispose: () => {
      scene.disposed.push(name);
      disposing();
    },
  };
}
