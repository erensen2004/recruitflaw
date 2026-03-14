import app from "./app.js";
import { seedIfEmpty } from "./lib/seed.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

async function main() {
  await seedIfEmpty();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
