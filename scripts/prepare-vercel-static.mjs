import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const sourceDir = resolve(rootDir, "artifacts/ats-platform/dist/public");
const targetDir = resolve(rootDir, "public");

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
