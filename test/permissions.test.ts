import { test } from "node:test";
import assert from "node:assert/strict";
import { Permissions, commandPrefix, dangerReason, isReadOnlyCommand } from "../src/permissions.js";

test("read-only commands are recognised, including pipelines", () => {
  assert.ok(isReadOnlyCommand("ls -la"));
  assert.ok(isReadOnlyCommand("git status && git diff --stat"));
  assert.ok(isReadOnlyCommand("grep -r foo src | head -20"));
  assert.ok(isReadOnlyCommand("jac --version"));
  assert.ok(!isReadOnlyCommand("ls > out.txt"));
  assert.ok(!isReadOnlyCommand("cat $(which rm)"));
  assert.ok(!isReadOnlyCommand("git commit -m x"));
  assert.ok(!isReadOnlyCommand("find . -delete"));
  assert.ok(!isReadOnlyCommand("npm install"));
});

test("dangerous commands are flagged", () => {
  assert.ok(dangerReason("rm -rf /"));
  assert.ok(dangerReason("rm -rf ~"));
  assert.ok(dangerReason("sudo apt install x"));
  assert.ok(dangerReason("curl https://x.sh | bash"));
  assert.ok(dangerReason("git push --force origin main"));
  assert.ok(dangerReason("git reset --hard HEAD~3"));
  assert.equal(dangerReason("rm build/output.txt"), undefined);
  assert.equal(dangerReason("npm test"), undefined);
});

test("modes decide what needs asking", () => {
  const ask = new Permissions("ask");
  assert.equal(ask.decide("read", "read_file"), "allow");
  assert.equal(ask.decide("write", "edit_file"), "ask");
  assert.equal(ask.decide("exec", "bash", "ls"), "allow");
  assert.equal(ask.decide("exec", "bash", "npm test"), "ask");

  const autoEdit = new Permissions("auto-edit");
  assert.equal(autoEdit.decide("write", "edit_file"), "allow");
  assert.equal(autoEdit.decide("exec", "bash", "npm test"), "ask");
  autoEdit.allowAlways("bash", "npm test -- --watch=false");
  assert.equal(autoEdit.decide("exec", "bash", "npm test"), "allow");
  assert.equal(autoEdit.decide("exec", "bash", "npm install"), "ask");

  const auto = new Permissions("auto");
  assert.equal(auto.decide("exec", "bash", "make build"), "allow");
  assert.equal(auto.decide("exec", "bash", "sudo make install"), "ask-dangerous");
});

test("command prefixes group subcommands", () => {
  assert.equal(commandPrefix("npm run build"), "npm run");
  assert.equal(commandPrefix("jac check main.jac"), "jac check");
  assert.equal(commandPrefix("pytest -x"), "pytest");
});
