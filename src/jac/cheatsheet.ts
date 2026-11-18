/**
 * Compact Jac syntax notes for the system prompt, targeting Jac 0.40.
 * Condensed from the official guides that ship with the `jac` binary
 * (jac-essentials, jac-core-cheatsheet, jac-testing; MIT licence, Jaseci Labs).
 * When the installed compiler disagrees, the compiler wins.
 */
export const JAC_TARGET_VERSION = "0.40";

export const JAC_INSTALL =
  "curl -fsSL https://raw.githubusercontent.com/jaseci-labs/jaseci/main/scripts/install.sh | bash";

export const JAC_CHEATSHEET = `
# Jac (target ${JAC_TARGET_VERSION}) — rules models most often get wrong
Jac is strictly typed, Python-flavoured, brace-delimited. Write Jac, not Python or JS.

Basics
- Every statement ends with \`;\`; every block uses \`{ }\`. Exception: \`match\` arms are \`case X:\` plus indentation.
- A function body's final expression without \`;\` is its return value; elsewhere a missing \`;\` is an error.
- Annotate every \`def\` parameter, return type and \`has\` field. Dynamic escape hatch: lowercase \`any\`.
- Top-level code runs in \`with entry { ... }\` (runs on every import). Script/demo code: \`with entry:__main__ { ... }\`.
- Module variables: \`glob count: int = 0;\` There is no \`global\`/\`nonlocal\`; assignment rebinds the enclosing binding.
- \`True\`/\`False\`/\`None\` are capitalized. Booleans: \`and\`/\`or\`/\`not\` (no \`&&\`, \`||\`). Ternary: \`a if c else b\`.
- No \`pass\`: an empty block is \`{}\`. Tuple unpacking in loops needs parens: \`for (k, v) in d.items() { }\`.
- Lambdas have one form: \`lambda (x: int) { x + 1; }\` or \`lambda (x: int) -> int { return x; }\`.
- Unused names warn (W2003): prefix with \`_\`, or write \`except ValueError { }\` without \`as e\`.
- Docstrings go before a declaration, never inside its body.
- Reserved words can't be names: node edge walker obj def impl visit report spawn disengage skip entry exit with can has. Escape with one leading backtick: \`\`visit\`.

Imports (Jac auto-imports nothing)
- \`import os;\`  \`import numpy as np;\`  ← module form takes \`;\`
- \`import from math { sqrt, pi }\`  ← brace form takes NO \`;\` (E0030 otherwise). \`import:py\` does not exist.
- Prefer project-root imports (\`import from shared.util { f }\`) over \`..\` relative ones.

Declarations
- \`def add(a: int, b: int) -> int { return a + b; }\`  (\`can\` is only for walker/node abilities)
- \`obj Point { has x: int = 0, y: int = 0; def norm() -> float { return (self.x ** 2 + self.y ** 2) ** 0.5; } }\`
- \`class\` keeps Python class semantics; \`obj\` is dataclass-like. Inherit with \`obj B(A) { }\`; a method that
  replaces the parent's is \`override def m() -> T { }\`.
- Declaration/implementation split: \`def area() -> float;\` in \`mod.jac\`, body in \`impl Shape.area() -> float { }\`
  inline or in \`mod.impl.jac\` (paired by basename, no import).
- \`enum Color { RED, GREEN }\`; value enums: \`enum Code: int { OK = 200 }\` (no \`.value\` needed).
- \`match v { case 0: return "zero"; case _: return "other"; }\`; C-style \`switch\` falls through, use \`break;\`.
  A \`match\` over an enum must cover every member or end with \`case _:\` (non-exhaustive is a type error).
- Values typed \`T | None\` must be narrowed (\`if x is not None { ... }\`) before attribute access or arithmetic.
- \`raise ValueError("msg");\`  Tuple assignment needs parens: \`(a, b) = (b, a + b);\`
- Also: f-strings, comprehensions, \`try { } except E as e { } finally { }\`, \`with open(p) as f { }\`, \`x?.y\`, \`d?["k"]\`.

Object-spatial programming
- \`node Person { has name: str; }\`  \`edge Friend { has since: int; }\`  \`walker Greeter { has count: int = 0; }\`
- \`root\` is a value (not \`root()\`). Connect: \`root ++> Person(name="A");\`  typed: \`a +>:Friend(since=2020):+> b;\`
- Traverse: \`[-->]\`, \`[root-->]\`; filter by type \`[root-->[?:Person]]\` or \`[-->][?:Person]\`, with a condition
  \`[here-->[?:Day, date == today]]\`; by edge type \`[->:Friend:->]\`.
- Walker abilities: \`can visit_person with Person entry { report here.name; visit [-->]; }\`; \`with Root entry\` runs at root.
- In a walker \`self\` is the walker and \`here\` the node; in a node ability \`self\` is the node and \`visitor\` the walker.
- \`visit\` queues nodes, \`report x;\` collects results, \`skip;\` ends this ability, \`disengage;\` stops the walk.
- Start: \`result = root spawn Greeter();\` then read \`result.reports\` (a list).

LLM functions
- \`import from jaclang.byllm.lib { Model }\`  \`glob llm = Model(model_name="...");\`
- \`def summarize(text: str) -> str by llm();\` — the signature and types are the prompt.

Tests (run with \`jac test file.jac\`; \`jac run\` ignores them)
- \`test "adds numbers" { assert add(2, 3) == 5, "add broke"; }\`
- Exceptions: \`with testraises(ValueError) { parse("x"); }\`. Never name files \`test_*.jac\`.

Verify: \`jac check <file>\` (types too) after every edit, then \`jac test\`. Official guides: \`jac guide <name>\`
(e.g. jac-types, jac-walker-patterns, jac-node-edge-patterns, jac-by-llm, jac-testing, jac-sv-endpoints).
`.trim();
