// Runs every test/*.test.ts with tsx. Lists files itself so it works on Windows too (no shell globbing there).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const files = readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`);
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const r = spawnSync(process.execPath, [tsx, "--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
