import type { IncomingMessage, ServerResponse } from "http";
import app from "./app.js";
import { ensureAppReady } from "./lib/runtime.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (pathname.endsWith("/healthz")) {
    (app as any).handle(req, res);
    return;
  }

  await ensureAppReady();
  (app as any).handle(req, res);
}
