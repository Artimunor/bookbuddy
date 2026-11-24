interface StoreAccess<Repository> {
  eligible: () => Promise<boolean>;
  existing: () => boolean;
  authenticate: (prompt: string) => Promise<boolean>;
  sweepEphemeral: () => void;
  persistent: () => Promise<Repository>;
  memory: () => Repository;
}

export function createRepositoryAccess<Repository>(access: StoreAccess<Repository>) {
  let unlocked = false;
  let generation = 0;
  let swept = false;
  async function openStore(persistent: boolean) {
    // No memory store from this process can own files before the first open.
    if (!swept) {
      access.sweepEphemeral();
      swept = true;
    }
    return persistent ? access.persistent() : access.memory();
  }

  return {
    async open(prompt: string, requirePersistent = false): Promise<Repository | null> {
      const attempt = generation;
      if (!unlocked) {
        try {
          if (!await access.eligible()) return !requirePersistent && attempt === generation ? openStore(false) : null;
          if (attempt !== generation || (access.existing() && !await access.authenticate(prompt))) return null;
        } catch { return null; }
      }
      if (attempt !== generation) return null;
      const repository = await openStore(true);
      if (attempt !== generation) return null;
      unlocked = true;
      return repository;
    },
    lock() {
      generation++;
      unlocked = false;
    },
    // Disposal may open the store without granting any session access to it.
    openForSignOut: openStore,
  };
}
