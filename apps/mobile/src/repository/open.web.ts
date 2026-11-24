import { uuid } from "expo";
import { transferFiles } from "../media/files";
import { createMemoryExecutor } from "./memory";
import { MobileRepository } from "./repository";

let repository: MobileRepository | undefined;

export async function openMobileRepository(_promptMessage: string): Promise<MobileRepository> {
  return repository ??= new MobileRepository(createMemoryExecutor(), uuid.v4, Date.now, transferFiles.erase);
}

export async function openSignOutRepository(_persistent: boolean): Promise<MobileRepository> {
  return repository ??= new MobileRepository(createMemoryExecutor(), uuid.v4, Date.now, transferFiles.erase);
}
export async function removeStagedFiles(uris: readonly string[]) {
  await Promise.all(uris.map(transferFiles.erase));
}
