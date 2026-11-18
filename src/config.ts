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
  /** Compact prompt, core tools and short tool output for small models. Default: on for Ollama. */
  lite?: boolean;
  /** Plugins to turn on (if off by default) or off. */
  plugins?: { enable?: string[]; disable?: string[] };
}

/** Free default: Qwen3.5-4B (Apache 2.0, ~2.7 GB), downloaded automatically on first use. Swap in your trained model. */
export const DEFAULT_MODELS = { anthropic: "claude-opus-5-5", ollama: "hf.co/unsloth/Qwen3.5-4B-GGUF:Q4_K_M" } as const;

/** True when Claude credentials look available (env vars or an `ant auth login` profile). */
export function hasAnthropicCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) return true;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return fs.existsSync(path.join(home, ".config", "anthropic"));
}

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

  const files = { ...readJson(path.join(globalDir(), "config.json")), ...readJson(path.join(root, ".jaccode.json")) };
  const fileProvider = files.provider;
  const fileModel = files.model;
  const merged: Config = {
    ...DEFAULTS,
    ...files,
    ...env,
    ...stripUndefined(flags),
  };
  // No provider chosen anywhere and no Claude credentials: use the free local model.
  const chosen = flags.provider ?? env.provider ?? fileProvider;
  if (!chosen && !(flags.model ?? env.model ?? fileModel) && !hasAnthropicCredentials()) {
    merged.provider = "ollama";
    merged.model = DEFAULT_MODELS.ollama;
  }
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
