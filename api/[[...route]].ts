import type { IncomingMessage, ServerResponse } from "http";

let appLoader:
  | Promise<{
      app: any;
      ensureAppReady: () => Promise<void>;
    }>
  | undefined;

function loadApp() {
  if (!appLoader) {
    appLoader = Promise.all([
      import("../artifacts/api-server/src/app.js"),
      import("../artifacts/api-server/src/lib/runtime.js"),
    ]).then(([appModule, runtimeModule]) => ({
      app: appModule.default,
      ensureAppReady: runtimeModule.ensureAppReady,
    }));
  }

  return appLoader;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { app, ensureAppReady } = await loadApp();
  await ensureAppReady();
  app.handle(req, res, () => undefined);
}
