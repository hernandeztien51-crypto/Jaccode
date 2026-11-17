import fs from "node:fs";
import path from "node:path";

export class PathError extends Error {}

/**
 * Resolves a model-supplied path inside the project root. Model output is
 * untrusted: `..`, absolute paths elsewhere and symlinks that lead out of the
 * root are all rejected.
 */
export function resolveInRoot(root: string, p: string): string {
  if (typeof p !== "string" || p.length === 0) throw new PathError("path is empty");
  const realRoot = realpathOrSelf(root);
  const target = path.resolve(realRoot, expandHome(p));
  assertInside(realRoot, target, p);

  // Canonicalize the deepest existing ancestor so a symlink can't escape.
  let existing = target;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const realExisting = realpathOrSelf(existing);
  const rest = path.relative(existing, target);
  assertInside(realRoot, path.join(realExisting, rest), p);
  return target;
}

function assertInside(root: string, target: string, original: string): void {
  const rel = path.relative(root, target);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new PathError(`"${original}" is outside the project root (${root})`);
  }
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) return path.join(process.env.HOME ?? "", p.slice(1));
  return p;
}

/** Path relative to the root, for display. */
export function displayPath(root: string, abs: string): string {
  const rel = path.relative(realpathOrSelf(root), abs);
  return rel === "" ? "." : rel;
}
