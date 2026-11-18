/**
 * Parses `jac check` / `jac run` output into structured diagnostics.
 *
 * The compiler prints each one as:
 *   error[E1001]: Cannot assign int to str
 *     --> app.jac:2:5
 *       2 |     y: str = x;
 *     → run 'jac guide jac-types' for guidance
 */
export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  col?: number;
  /** Guide the compiler pointed to, e.g. "jac-types". */
  guide?: string;
}

/** Short fix hints for the errors models hit most, from the Jac 0.40 diagnostics reference and guides. */
export const FIX_HINTS: Record<string, string> = {
  E0001: "parse error: check braces, `case X:` arms and lambda form `lambda (x: int) { ... }`",
  E0002: "a statement is missing its `;`",
  E0010: "unsupported keyword (e.g. `pass`): use `{}` for an empty block",
  E0030: "brace imports take no `;`: `import from m { a, b }`",
  E1001: "type mismatch: fix the value or the annotation",
  E1002: "return type mismatch (lowercase `true`/`false`/`null` also cause this: use `True`/`False`/`None`)",
  E1050: "missing required arguments; fields without defaults must be passed (give walker `has reports` a `= []` default)",
  E1099: "the value may be None or lack that attribute: narrow with `if x is not None { ... }` first",
  E1160: "an operand may be None: guard with `if x is not None` or give a default",
  E2084: "only the last expression of a body may omit `;` (implicit return)",
  W2003: "unused name: prefix with `_`, or drop `as e` from `except`",
  W0060: "docstrings go before the declaration, not inside its body",
};

const HEADER = /^\s*(error|warning)\[([EW]\d{4})\]:\s*(.*)$/;
const LOCATION = /^\s*-->\s*(.+?):(\d+):(\d+)/;
const GUIDE = /run 'jac guide ([\w./-]+)'/;

export function parseDiagnostics(output: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  let current: Diagnostic | undefined;
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const h = HEADER.exec(line);
    if (h) {
      current = { severity: h[1] as Diagnostic["severity"], code: h[2]!, message: h[3]!.trim() };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const loc = LOCATION.exec(line);
    if (loc && current.file === undefined) {
      current.file = loc[1];
      current.line = Number(loc[2]);
      current.col = Number(loc[3]);
      continue;
    }
    const g = GUIDE.exec(line);
    if (g) current.guide = g[1];
  }
  return out;
}

/**
 * A compact, de-duplicated summary for the model: errors first, one line each with a fix hint
 * and the guide to read. Keeps feedback short for small models.
 */
export function summarizeDiagnostics(diags: Diagnostic[], max = 12): string {
  if (diags.length === 0) return "";
  const seen = new Set<string>();
  const sorted = [...diags].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const unique = sorted.filter((d) => {
    const key = `${d.code}|${d.file}|${d.line}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const lines: string[] = [];
  for (const d of unique.slice(0, max)) {
    const where = d.file ? `${d.file}:${d.line}:${d.col} ` : "";
    const hint = FIX_HINTS[d.code] ? ` — hint: ${FIX_HINTS[d.code]}` : "";
    const guide = d.guide ? ` (jac guide ${d.guide})` : "";
    lines.push(`${where}${d.severity} ${d.code}: ${d.message}${hint}${guide}`);
  }
  const errors = diags.filter((d) => d.severity === "error").length;
  const warnings = diags.length - errors;
  const more = unique.length > max ? `\n… ${unique.length - max} more omitted` : "";
  return `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}:\n${lines.join("\n")}${more}`;
}
