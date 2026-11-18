import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { globalDir } from "../prompt.js";
import { defineTool, ToolError } from "./tool.js";

/** Pages fetched within this window are served from cache without touching the network. */
const FRESH_MS = 10 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

interface CacheEntry {
  url: string;
  status: number;
  contentType: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  body: string;
}

const memory = new Map<string, CacheEntry>();

function cacheDir(): string {
  return path.join(globalDir(), "cache", "fetch");
}

function cacheFile(url: string): string {
  return path.join(cacheDir(), crypto.createHash("sha256").update(url).digest("hex").slice(0, 32) + ".json");
}

function readCache(url: string): CacheEntry | undefined {
  const hit = memory.get(url);
  if (hit) return hit;
  try {
    const e = JSON.parse(fs.readFileSync(cacheFile(url), "utf8")) as CacheEntry;
    memory.set(url, e);
    return e;
  } catch {
    return undefined;
  }
}

function writeCache(e: CacheEntry): void {
  memory.set(e.url, e);
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cacheFile(e.url), JSON.stringify(e));
  } catch {
    /* cache is best-effort */
  }
}

/** github.com/<o>/<r>/blob/<ref>/<path> → raw file: faster and no page chrome. */
export function rewriteUrl(url: string): string {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Small, dependency-free HTML → readable text (headings, lists, links, code blocks kept). */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim());
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(s);
  if (main && main[2]!.length > 500) s = main[2]!;
  s = s.replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const blocks: string[] = [];
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) => {
    blocks.push(decode(code.replace(/<[^>]+>/g, "")));
    return `\n\u0000${blocks.length - 1}\u0000\n`;
  });
  s = s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t}\n\n`)
    .replace(/<a\s[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => {
      const label = t.replace(/<[^>]+>/g, "").trim();
      return label ? `[${label}](${href})` : "";
    })
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|tr|table|ul|ol|blockquote|dd|dt)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  s = decode(s)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => "```\n" + blocks[Number(i)]!.trim() + "\n```")
    .trim();
  return { title, text: s };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  source: "memory" | "revalidated" | "network";
  ms: number;
}

/** Fetches one URL with cache, conditional revalidation, timeout and a size cap. */
export async function fetchUrl(rawUrl: string, signal: AbortSignal, maxAgeMs = FRESH_MS): Promise<FetchResult> {
  const url = rewriteUrl(rawUrl);
  const started = Date.now();
  const cached = readCache(url);
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) {
    return { url, status: cached.status, contentType: cached.contentType, body: cached.body, source: "memory", ms: Date.now() - started };
  }
  const headers: Record<string, string> = {
    "user-agent": "jaccode (terminal coding agent)",
    accept: "text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5",
  };
  if (cached?.etag) headers["if-none-match"] = cached.etag;
  if (cached?.lastModified) headers["if-modified-since"] = cached.lastModified;
  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
  if (res.status === 304 && cached) {
    writeCache({ ...cached, fetchedAt: Date.now() });
    await res.body?.cancel();
    return { url, status: cached.status, contentType: cached.contentType, body: cached.body, source: "revalidated", ms: Date.now() - started };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (/^(image|audio|video|font)\/|application\/(octet-stream|zip|pdf|gzip)/.test(contentType)) {
    await res.body?.cancel();
    throw new ToolError(`${url} is binary (${contentType}); fetch only reads text.`);
  }
  const body = await readCapped(res);
  if (res.ok) {
    writeCache({
      url,
      status: res.status,
      contentType,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
      fetchedAt: Date.now(),
      body,
    });
  }
  return { url, status: res.status, contentType, body, source: "network", ms: Date.now() - started };
}

function render(r: FetchResult, maxChars: number, raw: boolean): string {
  let title = "";
  let text = r.body;
  if (!raw && /html/.test(r.contentType)) ({ title, text } = htmlToText(r.body));
  else if (!raw && /json/.test(r.contentType)) {
    try {
      text = JSON.stringify(JSON.parse(r.body), null, 2);
    } catch {
      /* leave as is */
    }
  }
  const cut = text.length > maxChars ? `${text.slice(0, maxChars)}\n… [${text.length - maxChars} more characters; raise max_chars to read on]` : text;
  const head = `## ${title || r.url}\n${r.url} · ${r.status} · ${(r.body.length / 1024).toFixed(1)} KB · ${r.source} · ${r.ms} ms`;
  return `${head}\n\n${cut}`;
}

export const fetchTool = defineTool({
  name: "fetch",
  description:
    "Fetch web pages, docs or raw files over HTTP(S), several in parallel. HTML is converted to readable text; " +
    "GitHub file links are fetched raw. Recent pages come from a local cache instantly. Use it for documentation " +
    "(e.g. https://docs.jaseci.org), package pages, API references and raw source files.",
  kind: "exec",
  schema: z.object({
    urls: z.array(z.string()).min(1).max(8).describe("http(s) URLs to fetch in parallel"),
    max_chars: z.number().int().min(500).max(200000).optional().describe("Characters to return per page (default 20000)"),
    raw: z.boolean().optional().describe("Return the body unconverted"),
  }),
  summary: (i) => `fetch ${i.urls.map((u) => u.replace(/^https?:\/\//, "")).join(", ")}`,
  command: (i) => `fetch ${[...new Set(i.urls.map((u) => { try { return new URL(u).host; } catch { return u; } }))].join(" ")}`,
  async run(i, ctx) {
    for (const u of i.urls) {
      if (!/^https?:\/\//i.test(u)) throw new ToolError(`Only http(s) URLs can be fetched: ${u}`);
    }
    const results = await Promise.allSettled(i.urls.map((u) => fetchUrl(u, ctx.signal)));
    return results
      .map((r, n) => (r.status === "fulfilled" ? render(r.value, i.max_chars ?? 20000, !!i.raw) : `## ${i.urls[n]}\nFailed: ${(r.reason as Error).message}`))
      .join("\n\n---\n\n");
  },
});
