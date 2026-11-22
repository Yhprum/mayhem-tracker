// A setting read by more than one part of the window and changed from
// Settings, held here so every reader sees a change without a reload. The
// database is read once per launch, before the first render (see main.tsx);
// after that every write goes through this copy.
export type SettingStore<T> = {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
  load: () => Promise<void>;
  set: (value: T) => Promise<void>;
};

export function createSettingStore<T>(
  key: string,
  initial: T,
  parse: (raw: string) => T,
  serialize: (value: T) => string,
): SettingStore<T> {
  let value = initial;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: T) => {
    value = next;
    for (const listener of listeners) listener();
  };

  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // A setting that can't be read keeps its initial value
    load() {
      loading ??= window.api.getSetting(key).then(
        (raw) => {
          if (raw !== null) publish(parse(raw));
        },
        () => {},
      );
      return loading;
    },
    async set(next) {
      publish(next);
      await window.api.setSetting(key, serialize(next));
    },
  };
}
