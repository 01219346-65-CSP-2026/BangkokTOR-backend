import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Small helpers for the checklist tests. You do not need to change this file.
//
// The checklist tests check the WIRING of a branch — files deleted, fields
// added, the right things imported — the parts a unit test cannot see.

const ROOT = join(import.meta.dir, "..");

/** Does this file exist? Path is relative to the repo root. */
export function exists(path: string): boolean {
  return existsSync(join(ROOT, path));
}

/** The text of a source file ("" if it does not exist). */
export function source(path: string): string {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

/** Import a module by repo-relative path, with a readable error if missing. */
export async function load<T = Record<string, any>>(path: string): Promise<T> {
  if (!exists(path)) throw new Error(`${path} does not exist yet — create it (see LEARNING.md)`);
  return (await import(join(ROOT, path))) as T;
}
