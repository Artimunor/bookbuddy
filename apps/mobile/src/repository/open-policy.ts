interface StoreAccess<Repository> {
  eligible: () => Promise<boolean>;
  existing: () => boolean;
  authenticate: (prompt: string) => Promise<boolean>;
  sweepEphemeral: () => void;
  persistent: () => Promise<Repository>;
  memory: () => Repository;
}

export type RepositoryOpening<Repository> =
  | { status: "open"; repository: Repository }
  | { status: "unavailable" | "denied" };

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
    async open(prompt: string, requiresUnlock = false): Promise<RepositoryOpening<Repository>> {
      const attempt = generation;
      let persistent = true;
      if (!unlocked) {
        try {
          persistent = await access.eligible();
          if (attempt !== generation) return { status: "denied" };
          if (!persistent) {
            if (requiresUnlock) return { status: "unavailable" };
          } else if ((requiresUnlock || access.existing()) && !await access.authenticate(prompt)) return { status: "denied" };
        } catch { return { status: "denied" }; }
      }
      if (attempt !== generation) return { status: "denied" };
      const repository = await openStore(persistent);
      if (attempt !== generation) return { status: "denied" };
      unlocked = persistent;
      return { status: "open", repository };
    },
    lock() {
      generation++;
      unlocked = false;
    },
    // Disposal may open the store without granting any session access to it.
    openForSignOut: openStore,
  };
}
