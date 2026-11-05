/** A profile memento that reads `initial` under any key until it is written, and keeps each value it is given. */
export function mementoOf(initial?: unknown): {
  get(key: string): unknown;
  update(key: string, value: unknown): Promise<void>;
  writes: unknown[];
} {
  const values = new Map<string, unknown>();
  const writes: unknown[] = [];
  return {
    get: key => (values.has(key) ? values.get(key) : initial),
    update: (key, value) => {
      values.set(key, value);
      writes.push(value);
      return Promise.resolve();
    },
    writes,
  };
}
