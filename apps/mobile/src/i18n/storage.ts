type WebStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
const web = globalThis as typeof globalThis & { localStorage?: WebStorage };

export const localPreferenceStorage = {
  read: async (key: string) => web.localStorage?.getItem(key) ?? null,
  write: async (key: string, value: string) => { web.localStorage?.setItem(key, value); },
  remove: async (key: string) => { web.localStorage?.removeItem(key); },
};
