import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Agent, type AgentUI, type Answer } from "../src/agent.js";
import { Permissions } from "../src/permissions.js";
import { MockProvider, type ScriptedTurn } from "../src/providers/mock.js";
import type { PermissionMode } from "../src/types.js";

function harness(script: ScriptedTurn[], opts: { mode?: PermissionMode; answers?: Answer[]; verify?: string } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jaccode-agent-")));
  const provider = new MockProvider(script);
  const log: string[] = [];
  const answers = [...(opts.answers ?? [])];
  const ui: AgentUI = {
    onEvent: () => {},
    toolStart: (t, s) => log.push(`start ${s}`),
    toolEnd: (t, o, e) => log.push(`${e ? "error" : "end"} ${t}`),
    ask: async (r) => {
      log.push(`ask ${r.summary}${r.danger ? " (danger)" : ""}`);
      return answers.shift() ?? "no";
    },
    notice: (t) => log.push(`notice ${t}`),
    todos: () => {},
    turnStart: () => {},
    turnEnd: () => {},
  };
  const agent = new Agent({
    root,
    provider,
    permissions: new Permissions(opts.mode ?? "auto-edit"),
    ui,
    system: "test",
    verifyCommand: opts.verify,
    autoJacCheck: false,
  });
  return { root, provider, agent, log };
}

const signal = () => new AbortController().signal;

test("runs a read → edit → answer loop and returns tool results to the model", async () => {
  const { root, provider, agent, log } = harness([
    { toolCalls: [{ id: "1", name: "read_file", input: { path: "app.jac" } }] },
    { toolCalls: [{ id: "2", name: "edit_file", input: { path: "app.jac", old_string: "1", new_string: "2" } }] },
    { text: "Done." },
  ]);
  fs.writeFileSync(path.join(root, "app.jac"), "with entry { print(1); }\n");
  const answer = await agent.run("bump it", signal());
  assert.equal(answer, "Done.");
  assert.equal(fs.readFileSync(path.join(root, "app.jac"), "utf8"), "with entry { print(2); }\n");
  assert.deepEqual(log, ["start read app.jac", "end read_file", "start edit app.jac", "end edit_file"]);
  assert.match(provider.received.toolResults[1]![0]!.content, /1 replacement/);
});

test("invalid tool input is returned as an error, not executed", async () => {
  const { provider, agent } = harness([
    { toolCalls: [{ id: "1", name: "write_file", input: { path: "x.txt" } }] },
    { text: "ok" },
  ]);
  await agent.run("go", signal());
  const r = provider.received.toolResults[0]![0]!;
  assert.equal(r.isError, true);
  assert.match(r.content, /INVALID_INPUT/);
});

test("declined permissions are reported back to the model", async () => {
  const { root, provider, agent, log } = harness(
    [{ toolCalls: [{ id: "1", name: "bash", input: { command: "touch made.txt" } }] }, { text: "ok" }],
    { mode: "ask", answers: ["no"] },
  );
  await agent.run("go", signal());
  assert.ok(log.includes("ask $ touch made.txt"));
  assert.equal(fs.existsSync(path.join(root, "made.txt")), false);
  assert.match(provider.received.toolResults[0]![0]!.content, /declined/);
});

test("dangerous commands ask even in auto mode", async () => {
  const { log, agent } = harness(
    [{ toolCalls: [{ id: "1", name: "bash", input: { command: "sudo rm -rf /" } }] }, { text: "ok" }],
    { mode: "auto" },
  );
  await agent.run("go", signal());
  assert.ok(log.some((l) => l.includes("(danger)")));
});

test("tool calls cut off at max_tokens are not run", async () => {
  const { root, provider, agent } = harness([
    { toolCalls: [{ id: "1", name: "write_file", input: { path: "big.txt", content: "trunc" } }], stop: "max_tokens" },
    { text: "ok" },
  ]);
  await agent.run("go", signal());
  assert.equal(fs.existsSync(path.join(root, "big.txt")), false);
  assert.match(provider.received.toolResults[0]![0]!.content, /token limit/);
});

test("repeated identical calls get a nudge", async () => {
  const call = { id: "x", name: "read_file", input: { path: "missing.txt" } };
  const { provider, agent } = harness([{ toolCalls: [call] }, { toolCalls: [call] }, { toolCalls: [call] }, { text: "ok" }]);
  await agent.run("go", signal());
  assert.match(provider.received.toolResults[2]![0]!.content, /exact call 3 times/);
});

test("failed verification is fed back to the model once per round", async () => {
  const { root, provider, agent } = harness(
    [
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "ok.txt", content: "bad" } }] },
      { text: "first try" },
      { toolCalls: [{ id: "2", name: "read_file", input: { path: "ok.txt" } }] },
      { toolCalls: [{ id: "3", name: "write_file", input: { path: "ok.txt", content: "good" } }] },
      { text: "fixed" },
    ],
    { verify: "grep -q good ok.txt" },
  );
  const answer = await agent.run("go", signal());
  assert.equal(answer, "fixed");
  assert.match(provider.received.users[1]!, /automatic verification/);
  assert.equal(fs.readFileSync(path.join(root, "ok.txt"), "utf8"), "good");
});

test("refusals stop the turn with a notice", async () => {
  const { agent, log } = harness([{ stop: "refusal", note: "policy" }]);
  await agent.run("go", signal());
  assert.ok(log.some((l) => l.includes("declined this request: policy")));
});

test("small-model mode refuses tools it wasn't offered and caps long results", async () => {
  const { LITE_TOOLS } = await import("../src/tools/index.js");
  const { root, provider, agent } = harness([
    { toolCalls: [{ id: "1", name: "multi_edit", input: { path: "a.txt", edits: [] } }] },
    { toolCalls: [{ id: "2", name: "read_file", input: { path: "big.txt" } }] },
    { text: "ok" },
  ]);
  fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(20000));
  agent.setTools(LITE_TOOLS);
  agent.maxResultChars = 1000;
  await agent.run("go", signal());
  const [first, second] = provider.received.toolResults;
  assert.match(first![0]!.content, /Unknown tool "multi_edit"\. Available: read_file/);
  assert.ok(second![0]!.content.length < 1200);
  assert.match(second![0]!.content, /characters cut/);
});
