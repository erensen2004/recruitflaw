import type { IncomingMessage, ServerResponse } from "http";
import app from "./app.js";
import { ensureAppReady } from "./lib/runtime.js";

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ensureAppReady();
  (app as any).handle(req, res, () => undefined);
}
