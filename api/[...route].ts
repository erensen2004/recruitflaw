let appLoader:
  | Promise<{
      handle: (req: any, res: any) => Promise<void>;
    }>
  | undefined;

function loadApp() {
  if (!appLoader) {
    const handlerModulePath = "../artifacts/api-server/dist/" + "vercel.cjs";
    appLoader = import(handlerModulePath).then((module: any) => ({
      handle: module.handle ?? module.default?.handle ?? module.default,
    }));
  }

  return appLoader;
}

export default async function handler(req: any, res: any): Promise<void> {
  const { handle } = await loadApp();
  await handle(req, res);
}
