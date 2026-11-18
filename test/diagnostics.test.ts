import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostics, summarizeDiagnostics } from "../src/jac/diagnostics.js";

// Shapes taken from the Jac 0.40 diagnostics reference and jac-debugging guide.
const SAMPLE = `
\x1b[31merror[E1001]\x1b[0m: Cannot assign int to str
  --> app.jac:2:5
    2 |     y: str = x;
      |     ^^^^^^^^^^^
  → run 'jac guide jac-types' for guidance
warning[W2003]: 'e' is defined but never used
  --> app.jac:9:23
error[E0030]: Unexpected semicolon at module level
  --> app.jac:1:30
error[E1001]: Cannot assign int to str
  --> app.jac:2:5
app.jac FAILED [0%]
`;

test("parses errors, warnings, locations and guide pointers", () => {
  const d = parseDiagnostics(SAMPLE);
  assert.equal(d.length, 4);
  assert.deepEqual(d[0], {
    severity: "error",
    code: "E1001",
    message: "Cannot assign int to str",
    file: "app.jac",
    line: 2,
    col: 5,
    guide: "jac-types",
  });
  assert.equal(d[1]!.severity, "warning");
  assert.equal(d[2]!.line, 1);
});

test("summary puts errors first, dedupes and adds fix hints", () => {
  const s = summarizeDiagnostics(parseDiagnostics(SAMPLE));
  const lines = s.split("\n");
  assert.equal(lines[0], "3 errors, 1 warning:");
  assert.match(lines[1]!, /^app\.jac:2:5 error E1001: Cannot assign int to str — hint: .*\(jac guide jac-types\)$/);
  assert.match(lines[2]!, /E0030.*brace imports take no `;`/);
  assert.match(lines[3]!, /warning W2003/);
  assert.equal(lines.length, 4, "duplicate E1001 should be dropped");
});

test("no diagnostics gives an empty summary", () => {
  assert.equal(summarizeDiagnostics(parseDiagnostics("app.jac PASSED [100%]")), "");
});
