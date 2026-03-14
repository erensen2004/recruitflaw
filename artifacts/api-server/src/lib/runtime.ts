import { seedIfEmpty } from "./seed.js";

let appReadyPromise: Promise<void> | null = null;

export async function ensureAppReady(): Promise<void> {
  appReadyPromise ??= seedIfEmpty();
  await appReadyPromise;
}
