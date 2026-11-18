import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countForeignSyntax, loadTasks, runEval } from "../src/eval.js";
import { MockProvider } from "../src/providers/mock.js";
import { Recorder } from "../src/recorder.js";

const TASKS = path.resolve(import.meta.dirname, "..", "evals", "jac");

test("every task is complete and its reference reads as Jac", () => {
  const tasks = loadTasks(TASKS);
  assert.ok(tasks.length >= 25, `only ${tasks.length} tasks`);
  for (const t of tasks) {
    const refDir = path.join(t.dir, "reference");
    assert.ok(fs.existsSync(path.join(t.dir, "reference.jac")) || fs.existsSync(refDir), `${t.id}: reference`);
    assert.ok(fs.existsSync(path.join(t.dir, "solution.test.jac")), `${t.id}: solution.test.jac`);
    const refs = fs.existsSync(refDir)
      ? fs.readdirSync(refDir).map((f) => path.join(refDir, f))
      : [path.join(t.dir, "reference.jac")];
    for (const r of refs) {
      assert.equal(countForeignSyntax(fs.readFileSync(r, "utf8")), 0, `${t.id}: ${path.basename(r)} has Python/JS-style lines`);
    }
    const tests = fs.readFileSync(path.join(t.dir, "solution.test.jac"), "utf8");
    assert.equal(countForeignSyntax(tests), 0, `${t.id}: tests have Python/JS-style lines`);
  }
});

test("foreign syntax detector catches common Python-isms", () => {
  const broken = fs.readFileSync(path.join(TASKS, "fix_syntax", "setup", "solution.jac"), "utf8");
  assert.ok(countForeignSyntax(broken) >= 3);
  assert.equal(countForeignSyntax('print("a && b is true");'), 0);
  assert.equal(countForeignSyntax("def f(x):"), 1);
});

/** A stand-in `jac`: check fails on `&&`, test passes when check would. */
function fakeJac(): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fakejac-"));
  fs.writeFileSync(
    path.join(bin, "jac"),
    `#!/bin/bash
case "$1" in
  check|test) if grep -q '&&' "$2"; then echo "error: E0001 unexpected '&&'"; exit 1; fi; echo ok; exit 0;;
  *) exit 0;;
esac
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${process.env.PATH}`;
  return bin;
}

test("runner grades agent output and records verdicts", async () => {
  fakeJac();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rec-")), "runs.jsonl");
  const recorder = new Recorder(out);
  const scripts = [
    // fizzbuzz: writes a clean solution
    [
      { toolCalls: [{ id: "a", name: "write_file", input: { path: "solution.jac", content: "def fizzbuzz(n: int) -> list[str] { return []; }\n" } }] },
      { text: "done" },
    ],
    // palindrome: writes Python-style code that fails check
    [
      { toolCalls: [{ id: "b", name: "write_file", input: { path: "solution.jac", content: "def is_palindrome(s: str) -> bool:\n    return s && s\n" } }] },
      { text: "done" },
    ],
  ];
  const results = await runEval({
    tasksDir: TASKS,
    only: ["fizzbuzz", "palindrome"],
    makeProvider: () => new MockProvider(scripts.shift()!),
    recorder,
  });
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId.fizzbuzz!.passed, true);
  assert.equal(byId.palindrome!.compiles, false);
  assert.ok(byId.palindrome!.foreignSyntax >= 1);
  const lines = fs.readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].meta.task, "fizzbuzz");
  assert.equal(lines[0].meta.passed, true);
  assert.equal(lines[0].messages[0].role, "system");
  assert.equal(lines[0].messages[2].tool_calls[0].function.name, "write_file");
  assert.equal(lines[0].messages[3].role, "tool");
  assert.ok(lines[0].tools.some((t: { function: { name: string } }) => t.function.name === "jac"));
});

test("reference mode passes with a working compiler", async () => {
  fakeJac();
  const results = await runEval({ tasksDir: TASKS, reference: true, makeProvider: () => new MockProvider([]) });
  assert.ok(results.every((r) => r.passed), results.filter((r) => !r.passed).map((r) => r.id).join(","));
});
