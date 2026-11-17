import fs from "node:fs";
import path from "node:path";
import { globalDir } from "./prompt.js";
import type { Effort, PermissionMode } from "./types.js";

export interface Config {
  provider: "anthropic" | "ollama";
  model: string;
  effort: Effort;
  mode: PermissionMode;
  showThinking: boolean;
  verifyCommand?: string;
  autoJacCheck: boolean;
  ollamaHost?: string;
}

export const DEFAULT_MODELS = { anthropic: "claude-opus-5-5", ollama: "qwen3-coder" } as const;

const DEFAULTS: Config = {
  provider: "anthropic",
  model: DEFAULT_MODELS.anthropic,
  effort: "high",
  mode: "auto-edit",
  showThinking: true,
  autoJacCheck: true,
};

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const MODES: PermissionMode[] = ["ask", "auto-edit", "auto"];

function readJson(file: string): Partial<Config> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Config>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(`warning: ignoring ${file}: ${(err as Error).message}\n`);
    }
    return {};
  }
}

/** Defaults < ~/.jaccode/config.json < <root>/.jaccode.json < environment < flags. */
export function loadConfig(root: string, flags: Partial<Config>): Config {
  const env: Partial<Config> = {};
  if (process.env.JACCODE_PROVIDER) env.provider = process.env.JACCODE_PROVIDER as Config["provider"];
  if (process.env.JACCODE_MODEL) env.model = process.env.JACCODE_MODEL;
  if (process.env.JACCODE_EFFORT) env.effort = process.env.JACCODE_EFFORT as Effort;

  const merged: Config = {
    ...DEFAULTS,
    ...readJson(path.join(globalDir(), "config.json")),
    ...readJson(path.join(root, ".jaccode.json")),
    ...env,
    ...stripUndefined(flags),
  };
  // Picking a provider without a model picks that provider's default model.
  const explicitModel = flags.model ?? env.model;
  if (!explicitModel && (flags.provider ?? env.provider) && merged.provider !== DEFAULTS.provider) {
    merged.model = DEFAULT_MODELS[merged.provider];
  }
  if (!EFFORTS.includes(merged.effort)) throw new Error(`effort must be one of ${EFFORTS.join(", ")}`);
  if (!MODES.includes(merged.mode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
  if (!["anthropic", "ollama"].includes(merged.provider)) throw new Error(`provider must be anthropic or ollama`);
  return merged;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
