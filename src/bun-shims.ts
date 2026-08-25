/**
 * Bun compatibility shims. Loaded via `preload` in bunfig.toml, before any
 * application module runs.
 *
 * bson >= 7 has a static initializer that calls
 * `v8.startupSnapshot.isBuildingSnapshot()` to detect Node snapshot builds.
 * Bun exposes `startupSnapshot` but throws ERR_NOT_IMPLEMENTED from that
 * method, so the optional chaining in bson doesn't save it and importing
 * mongoose blows up. Stub it to `false` — we are never building a snapshot.
 */
const v8 = process.getBuiltinModule("v8") as typeof import("node:v8");

if (typeof v8?.startupSnapshot?.isBuildingSnapshot === "function") {
  try {
    v8.startupSnapshot.isBuildingSnapshot();
  } catch {
    v8.startupSnapshot.isBuildingSnapshot = () => false;
  }
}
