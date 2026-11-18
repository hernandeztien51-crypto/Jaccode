import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Checkpoints } from "../src/checkpoints.js";
import { editFile, multiEdit, readFile, writeFile, listDir } from "../src/tools/files.js";
import { grep, glob } from "../src/tools/search.js";
import { bash } from "../src/tools/shell.js";
import { toSpec, type ToolContext } from "../src/tools/tool.js";
import { resolveInRoot } from "../src/paths.js";

function setup(): ToolContext {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jaccode-test-")));
  return { root, checkpoints: new Checkpoints(), readFiles: new Map(), todos: [], signal: new AbortController().signal };
}

test("paths outside the root are rejected", { skip: process.platform === "win32" && "symlinks need admin on Windows" }, () => {
  const ctx = setup();
  assert.throws(() => resolveInRoot(ctx.root, "../etc/passwd"), /outside the project root/);
  assert.throws(() => resolveInRoot(ctx.root, "/etc/passwd"), /outside the project root/);
  fs.symlinkSync("/etc", path.join(ctx.root, "link"));
  assert.throws(() => resolveInRoot(ctx.root, "link/passwd"), /outside the project root/);
  assert.equal(resolveInRoot(ctx.root, "a/b.txt"), path.join(ctx.root, "a/b.txt"));
});

test("read_file numbers lines and honours offset/limit", async () => {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.root, "f.txt"), "one\ntwo\nthree\nfour");
  const out = await readFile.run({ path: "f.txt", offset: 2, limit: 2 }, ctx);
  assert.match(out, /^2\ttwo\n3\tthree/);
  assert.match(out, /1 more lines/);
});

test("edits require a prior read and a fresh file", async () => {
  const ctx = setup();
  const file = path.join(ctx.root, "a.jac");
  fs.writeFileSync(file, 'with entry { print("hi"); }\n');
  await assert.rejects(editFile.run({ path: "a.jac", old_string: "hi", new_string: "yo" }, ctx), /Read a.jac/);
  await readFile.run({ path: "a.jac" }, ctx);
  // Simulate an outside change after the read.
  fs.writeFileSync(file, 'with entry { print("hey"); }\n');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  await assert.rejects(editFile.run({ path: "a.jac", old_string: "hey", new_string: "yo" }, ctx), /changed on disk/);
  await readFile.run({ path: "a.jac" }, ctx);
  const out = await editFile.run({ path: "a.jac", old_string: "hey", new_string: "yo" }, ctx);
  assert.match(out, /1 replacement/);
  assert.equal(fs.readFileSync(file, "utf8"), 'with entry { print("yo"); }\n');
});

test("edit_file rejects ambiguous matches and hints on misses", async () => {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.root, "x.py"), "a = 1\nb = 1\n    def f():\n        pass\n");
  await readFile.run({ path: "x.py" }, ctx);
  await assert.rejects(editFile.run({ path: "x.py", old_string: "= 1", new_string: "= 2" }, ctx), /occurs 2 times/);
  await assert.rejects(
    editFile.run({ path: "x.py", old_string: "def f():\n    pass", new_string: "x" }, ctx),
    /appears at line 3/,
  );
  await editFile.run({ path: "x.py", old_string: "= 1", new_string: "= 2", replace_all: true }, ctx);
  assert.equal(fs.readFileSync(path.join(ctx.root, "x.py"), "utf8").match(/= 2/g)?.length, 2);
});

test("multi_edit is atomic", async () => {
  const ctx = setup();
  const file = path.join(ctx.root, "m.txt");
  fs.writeFileSync(file, "alpha beta gamma");
  await readFile.run({ path: "m.txt" }, ctx);
  await assert.rejects(
    multiEdit.run(
      { path: "m.txt", edits: [{ old_string: "alpha", new_string: "A" }, { old_string: "nope", new_string: "B" }] },
      ctx,
    ),
    /Edit 2 of 2 failed, nothing was changed/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "alpha beta gamma");
  await multiEdit.run(
    { path: "m.txt", edits: [{ old_string: "alpha", new_string: "A" }, { old_string: "A beta", new_string: "AB" }] },
    ctx,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "AB gamma");
});

test("checkpoints undo a whole turn, including created files", async () => {
  const ctx = setup();
  const existing = path.join(ctx.root, "keep.txt");
  fs.writeFileSync(existing, "original");
  ctx.checkpoints.beginTurn("turn 1");
  await readFile.run({ path: "keep.txt" }, ctx);
  await writeFile.run({ path: "keep.txt", content: "changed" }, ctx);
  await writeFile.run({ path: "new/dir/file.txt", content: "fresh" }, ctx);
  ctx.checkpoints.endTurn();
  assert.match(ctx.checkpoints.sessionDiff(ctx.root), /-original\n.*\n\+changed/);
  const r = ctx.checkpoints.undo();
  assert.equal(r?.files.length, 2);
  assert.equal(fs.readFileSync(existing, "utf8"), "original");
  assert.equal(fs.existsSync(path.join(ctx.root, "new/dir/file.txt")), false);
  assert.equal(ctx.checkpoints.undo(), null);
});

test("grep, glob and list_dir skip ignored folders", async () => {
  const ctx = setup();
  fs.mkdirSync(path.join(ctx.root, "src"));
  fs.mkdirSync(path.join(ctx.root, "node_modules/pkg"), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, "src/main.jac"), "walker Greeter {}\n");
  fs.writeFileSync(path.join(ctx.root, "node_modules/pkg/x.jac"), "walker Greeter {}\n");
  assert.equal(await grep.run({ pattern: "walker \\w+" }, ctx), "src/main.jac:1:walker Greeter {}");
  assert.equal(await glob.run({ pattern: "**/*.jac" }, ctx), "src/main.jac");
  assert.equal(await listDir.run({}, ctx), "src/\n  main.jac");
});

test("bash reports exit codes and times out", async () => {
  const ctx = setup();
  assert.match(await bash.run({ command: "echo hi; exit 3" }, ctx), /hi\n\[exit code 3\]/);
  assert.match(await bash.run({ command: "sleep 5", timeout_seconds: 1 }, ctx), /timed out after 1s/);
});

test("tool specs are clean JSON Schema", () => {
  const spec = toSpec(readFile);
  assert.equal(spec.inputSchema.type, "object");
  assert.equal("$schema" in spec.inputSchema, false);
  assert.deepEqual(spec.inputSchema.required, ["path"]);
});

test("outline lists Jac, Python and TypeScript declarations", async () => {
  const { outline } = await import("../src/tools/outline.js");
  const ctx = setup();
  fs.mkdirSync(path.join(ctx.root, "src"));
  fs.writeFileSync(
    path.join(ctx.root, "src/app.jac"),
    'node Person {\n    has name: str;\n}\n\nwalker Greet {\n    can hello with Person entry {\n        report here.name;\n    }\n}\n\ndef add(a: int, b: int) -> int {\n    return a + b;\n}\n\ntest "adds" { assert add(1, 2) == 3; }\n',
  );
  fs.writeFileSync(path.join(ctx.root, "src/util.py"), "class A:\n    def go(self) -> int:\n        return 1\n");
  const out = await outline.run({}, ctx);
  assert.match(out, /src\/app\.jac\n {4}1 {2}node Person\n {4}5 {2}walker Greet\n {4}6 {4}can hello with Person entry\n {3}11 {2}def add\(a: int, b: int\) -> int\n {3}15 {2}test "adds"/);
  assert.match(out, /src\/util\.py\n {4}1 {2}class A\n {4}2 {4}def go\(self\) -> int/);
});
