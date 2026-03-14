import app from "./app.js";
import { ensureAppReady } from "./lib/runtime.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

async function main() {
  await ensureAppReady();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
