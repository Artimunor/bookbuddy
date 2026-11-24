import { createMemoryExecutor } from "./memory.web";
import { MobileRepository } from "./repository";

let repository: MobileRepository | undefined;

export async function openMobileRepository(): Promise<MobileRepository> {
  return repository ??= new MobileRepository(createMemoryExecutor(), () => globalThis.crypto.randomUUID());
}

// The preview does not stage app-owned native files or persist any bytes.
export function stagedMediaDirectory(): string | null { return null; }
export async function removeStagedFiles(uris: readonly string[]) {
  if (uris.length) throw new Error("The preview cannot own staged native files");
}
