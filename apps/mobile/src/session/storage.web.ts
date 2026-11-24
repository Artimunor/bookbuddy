let stored: string | null = null;
export const sessionStorage = {
  read: async () => stored,
  save: async (value: string) => { stored = value; },
  remove: async () => { stored = null; },
};
