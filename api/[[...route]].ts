import type { IncomingMessage, ServerResponse } from "http";
import app from "../artifacts/api-server/src/app.js";
import { ensureAppReady } from "../artifacts/api-server/src/lib/runtime.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await ensureAppReady();
  (app as any).handle(req, res, () => undefined);
}
