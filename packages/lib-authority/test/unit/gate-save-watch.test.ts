import {deepStrictEqual} from 'node:assert';
import {
  type DocumentEvents,
  savedAndClosed,
} from '../../src/gate/save-watch.ts';

function fakeEvents(): {
  events: DocumentEvents;
  save(documentPath: string): void;
  close(documentPath: string): void;
  disposed: string[];
} {
  const saves: Array<(documentPath: string) => void> = [];
  const closes: Array<(documentPath: string) => void> = [];
  const disposed: string[] = [];
  return {
    events: {
      onSaved: listener => {
        saves.push(listener);
        return {
          dispose: () => {
            disposed.push('save');
          },
        };
      },
      onClosed: listener => {
        closes.push(listener);
        return {
          dispose: () => {
            disposed.push('close');
          },
        };
      },
    },
    save: documentPath => {
      for (const listener of saves) {
        listener(documentPath);
      }
    },
    close: documentPath => {
      for (const listener of closes) {
        listener(documentPath);
      }
    },
    disposed,
  };
}

function isArgv(documentPath: string): boolean {
  return documentPath === 'argv.json';
}

describe('the save-and-close watch', () => {
  it('settles true when the document was saved and then closed, and lets go of both listeners', async () => {
    const fake = fakeEvents();
    const result = savedAndClosed(fake.events, isArgv);
    fake.save('argv.json');
    fake.close('argv.json');
    deepStrictEqual([await result, fake.disposed], [true, ['save', 'close']]);
  });

  it('settles false when the document was closed without a save', async () => {
    const fake = fakeEvents();
    const result = savedAndClosed(fake.events, isArgv);
    fake.close('argv.json');
    deepStrictEqual(await result, false);
  });

  it('ignores other documents', async () => {
    const fake = fakeEvents();
    const result = savedAndClosed(fake.events, isArgv);
    fake.save('other.json');
    fake.close('other.json');
    fake.close('argv.json');
    deepStrictEqual(await result, false);
  });
});
