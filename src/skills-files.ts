/**
 * @file What agent-kitchen reads of the files of `skills-manager`: which skills of a catalog
 * the lock has and at which tag (the lock is where the manifest's `paths.lock` says), the
 * catalog's source in the manifest, which `skills-manager` to run (the one the repo pins,
 * or the latest 1.x), the repo's own skills (folders the lock does not know), and updating
 * skills one by one, because `skills-manager update` takes a single name.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dependencyVersion, isObject, readJson, writeJson } from "./repo.js";
import { SKILLS_LOCK, SKILLS_MANAGER, SKILLS_MANIFEST } from "./piece.js";
import { runNpx, type ToolRun } from "./tools.js";

/** Where `skills-manager` puts the skills when the manifest does not say. */
const SKILLS_DIR = ".agents/skills";

/** A skill in the lock: its name and the tag it is at. */
export interface LockedSkill {
  name: string;
  tag: string | null;
}

/**
 * Where the repo's skills lock is: the manifest's `paths.lock`, or the default.
 * @param root - The repo.
 * @returns The path, relative to the repo.
 * @example lockPath(root) // ".agents/skills.lock.json"
 */
export function lockPath(root: string): string {
  const paths = readJson(root, SKILLS_MANIFEST)?.paths;
  return isObject(paths) && typeof paths.lock === "string" && paths.lock !== "" ? paths.lock : SKILLS_LOCK;
}

/**
 * Every skill in the repo's lock, by name.
 * @param root - The repo.
 * @returns The lock's entries.
 * @example Object.keys(lockedSkills(root)) // ["close-pr", "code-audit"]
 */
export function lockedSkills(root: string): Record<string, unknown> {
  const lock = readJson(root, lockPath(root));
  return isObject(lock?.skills) ? lock.skills : {};
}

/**
 * Runs `skills-manager update <name>` for each skill, stopping at the first that fails.
 * @param root - The repo.
 * @param names - The skills.
 * @returns Null if every one worked, or the command that failed, to retry it, and what it printed.
 * @example await updateSkills(root, ["close-pr", "pr-review-comments"]) // null
 */
export async function updateSkills(root: string, names: string[]): Promise<{ command: string; run: ToolRun } | null> {
  const spec = skillsManagerSpec(root);
  for (const name of names) {
    const run = await runNpx(root, [spec, "update", name]);
    if (!run.ok) return { command: `npx ${spec} update ${name}`, run };
  }
  return null;
}

/**
 * The repo's own skills among some names: a folder in the skills folder that the lock does
 * not know, which `skills-manager` replaces only when allowed.
 * @param root - The repo.
 * @param names - The skills about to be installed.
 * @returns The names that are the repo's own.
 * @example ownSkills(root, ["planning", "code-audit"]) // ["planning"]
 */
export function ownSkills(root: string, names: string[]): string[] {
  const paths = readJson(root, SKILLS_MANIFEST)?.paths;
  const dir = join(root, isObject(paths) && typeof paths.skillsDir === "string" && paths.skillsDir !== "" ? paths.skillsDir : SKILLS_DIR);
  const folders = existsSync(dir) ? readdirSync(dir) : [];
  const locked = lockedSkills(root);
  return [...new Set(names)].filter((name) => folders.includes(name) && locked[name] === undefined);
}

/**
 * The skills of a catalog in the repo's lock.
 * @param root - The repo.
 * @param catalog - The catalog, as owner/name.
 * @returns Name and tag of each one.
 * @example catalogSkills(root, "ramon-sg/issue-flow") // [{ name: "close-pr", tag: "v0.2.0" }]
 */
export function catalogSkills(root: string, catalog: string): LockedSkill[] {
  const skills = lockedSkills(root);
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
