import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.JACCODE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "jaccode-home-"));
const { fetchUrl, htmlToText, rewriteUrl, fetchTool } = await import("../src/tools/fetch.js");

const PAGE = `<!doctype html><html><head><title>Walkers &amp; Nodes</title><style>.x{}</style></head>
<body><nav>menu</nav><main><h1>Walkers</h1><p>A walker <b>visits</b> nodes.</p>
<ul><li>visit</li><li>report</li></ul><p>See <a href="/docs/osp">the OSP guide</a>.</p>
<pre><code>walker W {
    can go with Root entry { visit [-->]; }
}</code></pre>${"<p>filler text for length</p>".repeat(30)}</main><script>alert(1)</script></body></html>`;

function server(): Promise<{ url: string; hits: () => number; close: () => void }> {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    if (req.url === "/bin") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(Buffer.alloc(10));
    }
    if (req.headers["if-none-match"] === '"v1"') {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", etag: '"v1"' });
    res.end(PAGE);
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, hits: () => hits, close: () => srv.close() });
    }),
  );
}

test("html becomes readable text with title, lists, links and code", () => {
  const { title, text } = htmlToText(PAGE);
  assert.equal(title, "Walkers & Nodes");
  assert.match(text, /^# Walkers/);
  assert.match(text, /A walker visits nodes\./);
  assert.match(text, /- visit\n- report/);
  assert.match(text, /\[the OSP guide\]\(\/docs\/osp\)/);
  assert.match(text, /```\nwalker W \{\n {4}can go with Root entry \{ visit \[-->\]; \}\n\}\n```/);
  assert.doesNotMatch(text, /alert|menu|\.x\{\}/);
});

test("cache: fresh hits skip the network, stale ones revalidate with 304", async () => {
  const s = await server();
  const signal = new AbortController().signal;
  const a = await fetchUrl(`${s.url}/page`, signal);
  assert.equal(a.source, "network");
  const b = await fetchUrl(`${s.url}/page`, signal);
  assert.equal(b.source, "memory");
  assert.equal(s.hits(), 1);
  const c = await fetchUrl(`${s.url}/page`, signal, 0);
  assert.equal(c.source, "revalidated");
  assert.equal(c.body, a.body);
  assert.equal(s.hits(), 2);
  s.close();
});

test("tool fetches in parallel, refuses binary and non-http URLs", async () => {
  const s = await server();
  const ctx = { root: os.tmpdir(), checkpoints: undefined as never, readFiles: new Map(), todos: [], signal: new AbortController().signal };
  const out = await fetchTool.run({ urls: [`${s.url}/other`, `${s.url}/bin`] }, ctx);
  assert.match(out, /## Walkers & Nodes/);
  assert.match(out, /Failed: .*binary/);
  await assert.rejects(fetchTool.run({ urls: ["file:///etc/passwd"] }, ctx), /Only http/);
  s.close();
});

test("GitHub blob links are fetched raw", () => {
  assert.equal(
    rewriteUrl("https://github.com/jaseci-labs/jaseci/blob/main/README.md"),
    "https://raw.githubusercontent.com/jaseci-labs/jaseci/main/README.md",
  );
});
