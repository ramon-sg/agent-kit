/**
 * @file What agent-kit reads of the files of `skills-manager`: which skills of a catalog
 * the lock has and at which tag, the catalog's source in the manifest, and which
 * `skills-manager` to run (the one the repo pins, or the latest 1.x).
 */
import { dependencyVersion, isObject, readJson, writeJson } from "./repo.js";
import { SKILLS_LOCK, SKILLS_MANAGER, SKILLS_MANIFEST } from "./piece.js";

/** A skill in the lock: its name and the tag it is at. */
export interface LockedSkill {
  name: string;
  tag: string | null;
}

/**
 * The skills of a catalog in the repo's lock.
 * @param root - The repo.
 * @param catalog - The catalog, as owner/name.
 * @returns Name and tag of each one.
 * @example catalogSkills(root, "ramon-sg/issue-flow") // [{ name: "close-pr", tag: "v0.2.0" }]
 */
export function catalogSkills(root: string, catalog: string): LockedSkill[] {
  const lock = readJson(root, SKILLS_LOCK);
  const skills = isObject(lock?.skills) ? lock.skills : {};
  return Object.entries(skills)
    .filter(([, entry]) => isObject(entry) && entry.source === `catalog:${catalog}`)
    .map(([name, entry]) => ({ name, tag: isObject(entry) && typeof entry.tag === "string" ? entry.tag : null }));
}

/**
 * The catalogs in the repo's skills manifest, with the ref each one is pinned to.
 * @param root - The repo.
 * @returns Each catalog and its ref (null if it follows the latest release).
 * @example manifestCatalogs(root) // [{ catalog: "ramon-sg/issue-flow", ref: "v0.2.0" }]
 */
export function manifestCatalogs(root: string): { catalog: string; ref: string | null }[] {
  const manifest = readJson(root, SKILLS_MANIFEST);
  const sources = Array.isArray(manifest?.sources) ? manifest.sources.filter(isObject) : [];
  return sources.flatMap((source) => (typeof source.catalog === "string" ? [{ catalog: source.catalog, ref: typeof source.ref === "string" ? source.ref : null }] : []));
}

/**
 * Pins a catalog of the manifest to a tag, so `skills-manager update` moves its skills there.
 * @param root - The repo.
 * @param catalog - The catalog.
 * @param tag - The tag, like v0.2.0.
 * @returns Whether the manifest has the catalog.
 * @example pinCatalog(root, "ramon-sg/issue-flow", "v0.2.0") // true
 */
export function pinCatalog(root: string, catalog: string, tag: string): boolean {
  const manifest = readJson(root, SKILLS_MANIFEST);
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  if (manifest === null || !sources.some((source) => isObject(source) && source.catalog === catalog)) return false;
  const moved = sources.map((source) => (isObject(source) && source.catalog === catalog ? { ...source, ref: tag } : source));
  writeJson(root, SKILLS_MANIFEST, { ...manifest, sources: moved });
  return true;
}

/**
 * The `skills-manager` to run: the version the repo pins in package.json, so the lock is
 * written by the same version every time, or the latest 1.x.
 * @param root - The repo.
 * @returns The npx spec.
 * @example skillsManagerSpec(root) // "@ramon-sg/skills-manager@1.1.0"
 */
export function skillsManagerSpec(root: string): string {
  return `${SKILLS_MANAGER}@${dependencyVersion(readJson(root, "package.json"), SKILLS_MANAGER) ?? "1"}`;
}
