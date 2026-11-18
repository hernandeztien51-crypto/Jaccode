import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { OllamaProvider } from "../src/providers/ollama.js";
import { loadConfig, DEFAULT_MODELS } from "../src/config.js";

test("a missing model is downloaded once, then the chat is retried", async () => {
  let pulled = false;
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.url!);
    req.resume();
    req.on("end", () => {
      if (req.url === "/api/chat" && !pulled) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "model 'tiny' not found, try pulling it first" }));
      }
      if (req.url === "/api/pull") {
        pulled = true;
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        for (const done of [0, 50, 100]) res.write(JSON.stringify({ status: "downloading", total: 100, completed: done }) + "\n");
        return res.end(JSON.stringify({ status: "success" }) + "\n");
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { role: "assistant", content: "hello" }, done: true, done_reason: "stop" }) + "\n");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const { port } = srv.address() as { port: number };
  const p = new OllamaProvider({ model: "tiny", effort: "high", host: `http://127.0.0.1:${port}` });
  p.addUserText("hi");
  const notices: string[] = [];
  const r = await p.turn("sys", [], (e) => e.type === "notice" && notices.push(e.text), new AbortController().signal);
  srv.close();
  assert.equal(r.text, "hello");
  assert.deepEqual(seen, ["/api/chat", "/api/pull", "/api/chat"]);
  assert.match(notices.join("\n"), /downloading tiny \(first use only\)[\s\S]*50%[\s\S]*tiny ready/);
});

test("with no Claude credentials and no provider chosen, the free local model is the default", () => {
  const saved = { ...process.env };
  try {
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "JACCODE_PROVIDER", "JACCODE_MODEL"]) delete process.env[k];
    process.env.HOME = process.env.USERPROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
    process.env.JACCODE_HOME = path.join(process.env.HOME, ".jaccode");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "proj-"));
    const free = loadConfig(root, {});
    assert.equal(free.provider, "ollama");
    assert.equal(free.model, DEFAULT_MODELS.ollama);
    process.env.ANTHROPIC_API_KEY = "x";
    assert.equal(loadConfig(root, {}).provider, "anthropic");
  } finally {
    process.env = saved;
  }
});
