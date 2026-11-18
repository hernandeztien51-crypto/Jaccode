import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.JACCODE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "jaccode-home-"));
const { loadPlugins, fillCommand, matchGlob, expandCommand, pluginPrompt } = await import("../src/plugins.js");
const { Agent } = await import("../src/agent.js");
const { Permissions } = await import("../src/permissions.js");
const { MockProvider } = await import("../src/providers/mock.js");

function project(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jaccode-plug-")));
  const dir = path.join(root, ".jaccode", "plugins", "demo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({
      name: "demo",
      description: "test plugin",
      commands: { hello: { description: "say hi", prompt: "Say hi to $ARGS" } },
      tools: [{ name: "count_lines", description: "Count lines", readOnly: true, command: "wc -l < {{file}}",
                parameters: { type: "object", properties: { file: { type: "string" } }, required: ["file"] } }],
      hooks: { afterEdit: [{ match: "*.txt", command: "echo hooked {{file}}" }] },
    }),
  );
  fs.mkdirSync(path.join(root, ".jaccode", "plugins", "broken"));
  fs.writeFileSync(path.join(root, ".jaccode", "plugins", "broken", "plugin.json"), "{ not json");
  return root;
}

test("bundled plugins load; defaults and overrides apply", () => {
  const { plugins, errors } = loadPlugins(fs.mkdtempSync(path.join(os.tmpdir(), "x-")));
  assert.deepEqual(errors, []);
  const names = plugins.map((p) => p.name);
  for (const n of ["git", "jac-docs", "jac-format", "jac-guides", "jac-workflows"]) assert.ok(names.includes(n), n);
  assert.equal(plugins.find((p) => p.name === "jac-format")!.enabled, false);
  const on = loadPlugins(os.tmpdir(), { enable: ["jac-format"], disable: ["git"] }).plugins;
  assert.equal(on.find((p) => p.name === "jac-format")!.enabled, true);
  assert.equal(on.find((p) => p.name === "git")!.enabled, false);
  assert.match(pluginPrompt(on.filter((p) => p.enabled)), /jac-walker-patterns/);
});

test("project plugins add commands and tools; broken manifests are reported, not fatal", { skip: process.platform === "win32" && "uses POSIX shell commands" }, async () => {
  const root = project();
  const { plugins, errors } = loadPlugins(root);
  const demo = plugins.find((p) => p.name === "demo")!;
  assert.equal(demo.source, "project");
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /broken/);
  assert.equal(expandCommand(demo.commands.hello!, "Ana"), "Say hi to Ana");
  fs.writeFileSync(path.join(root, "a.txt"), "1\n2\n3\n");
  const tool = demo.tools[0]!;
  assert.equal(tool.kind, "read");
  const ctx = { root, checkpoints: undefined as never, readFiles: new Map(), todos: [], signal: new AbortController().signal };
  assert.match(await tool.run({ file: "a.txt" }, ctx), /^3\n\[exit code 0\]/);
  assert.equal(tool.schema.safeParse({}).success, false, "required args are enforced");
});

test("arguments are quoted so they can't inject commands", { skip: process.platform === "win32" && "uses POSIX shell commands" }, () => {
  const cmd = fillCommand("echo {{x}}", { x: "a'; rm -rf / #" });
  assert.equal(cmd, `echo 'a'\\''; rm -rf / #'`);
  assert.equal(fillCommand("run {{missing}}", {}), "run ");
});

test("globs match by name or path", () => {
  assert.ok(matchGlob("*.jac", "src/app.jac"));
  assert.ok(!matchGlob("*.jac", "src/app.py"));
  assert.ok(matchGlob("src/**/*.ts", "src/a/b/c.ts"));
  assert.ok(matchGlob("src/**/*.ts", "src/c.ts"));
  assert.ok(!matchGlob("src/**/*.ts", "lib/c.ts"));
});

test("edit hooks run after writes and their output reaches the model", { skip: process.platform === "win32" && "uses POSIX shell commands" }, async () => {
  const root = project();
  const { plugins } = loadPlugins(root);
  const provider = new MockProvider([
    { toolCalls: [{ id: "1", name: "write_file", input: { path: "notes.txt", content: "hi" } }] },
    { text: "done" },
  ]);
  const ui = { onEvent() {}, toolStart() {}, toolEnd() {}, ask: async () => "no" as const, notice() {}, todos() {}, turnStart() {}, turnEnd() {} };
  const agent = new Agent({ root, provider, permissions: new Permissions("auto-edit"), ui, system: "t", autoJacCheck: false,
    editHooks: plugins.flatMap((p) => p.afterEdit) });
  await agent.run("write notes", new AbortController().signal);
  assert.match(provider.received.toolResults[0]![0]!.content, /\[hook echo hooked 'notes\.txt'\]\nhooked notes\.txt/);
});
