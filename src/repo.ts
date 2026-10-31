/**
 * @file The repo agent-kitchen works on: its main checkout (never a worktree, whose files are
 * not the ones the team commits from), the JSON files the pieces keep in it, and its
 * package manager.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KitError } from "./output.js";

/**
 * Whether a value is a plain JSON object.
 * @param value - The value.
 * @returns True for an object that is not an array nor null.
 * @example isObject({}) // true
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runs git in a folder.
 * @param cwd - The folder.
 * @param args - The arguments.
 * @returns Its trimmed stdout, or null if it failed.
 */
function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * The main checkout of the repo a folder is in.
 * @param cwd - The folder.
 * @param command - The command that runs, for the error.
 * @returns Its root, with symlinks resolved.
 * @throws KitError outside a git checkout or inside a worktree.
 * @example mainCheckout(process.cwd(), "agent-kitchen") // "/code/shop"
 */
export function mainCheckout(cwd: string, command: string): string {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (common === null || top === null) throw new KitError(`corre ${command} dentro del repo.`);
  const main = realpathSync(dirname(common));
  if (realpathSync(top) !== main) throw new KitError(`corre ${command} en la copia principal, ${main}, no en un worktree.`);
  return main;
}

/**
 * Reads a JSON object of the repo.
 * @param root - The repo.
 * @param path - The file, relative to the repo.
 * @returns The object, or null if the file does not exist.
 * @throws KitError if it is not valid JSON or not an object: it is never overwritten then.
 * @example readJson(root, ".claude/cloud.json")
 */
export function readJson(root: string, path: string): Record<string, unknown> | null {
  const file = join(root, path);
  if (!existsSync(file)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new KitError(`${path} no es JSON válido (${error instanceof Error ? error.message : String(error)}); arréglalo y corre otra vez.`);
  }
  if (!isObject(value)) throw new KitError(`${path} no es un objeto JSON; arréglalo y corre otra vez.`);
  return value;
}

/**
 * Writes a JSON file of the repo, indented by two spaces, creating its folder.
 * @param root - The repo.
 * @param path - The file, relative to the repo.
 * @param value - What to write.
 * @example writeJson(root, ".claude/cloud.json", { version: "1.1.0" })
 */
export function writeJson(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The version of a dependency in `package.json`, development or not.
 * @param pkg - The package.json, or null.
 * @param name - The package.
 * @returns The version, or null if it is not there.
 * @example dependencyVersion(pkg, "@ramon-sg/issue-flow") // "0.2.0"
 */
export function dependencyVersion(pkg: Record<string, unknown> | null, name: string): string | null {
  for (const field of ["devDependencies", "dependencies"]) {
    const deps = pkg?.[field];
    if (isObject(deps) && typeof deps[name] === "string") return deps[name];
  }
  return null;
}

/** The lockfile of each package manager, in the order they are looked for. */
const LOCKFILES: [string, string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * The repo's package manager: the `packageManager` field, then its lockfile, then npm.
 * @param root - The repo.
 * @returns `npm`, `pnpm`, `bun` or `yarn`.
 * @example packageManager(root) // "pnpm"
 */
export function packageManager(root: string): string {
  const pkg = readJson(root, "package.json");
  const field = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
  if (field !== undefined && field !== "") return field;
  return LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? "npm";
}

/**
 * The version of a package installed in the repo's `node_modules`.
 * @param root - The repo.
 * @param name - The package.
 * @returns Its version, or null if it is not installed.
 * @example installedVersion(root, "@ramon-sg/skills-manager") // "1.3.0"
 */
export function installedVersion(root: string, name: string): string | null {
  const file = join(root, "node_modules", name, "package.json");
  if (!existsSync(file)) return null;
  try {
    const pkg: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isObject(pkg) && typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Sets the version of a dependency in package.json, changing nothing else: the file keeps
 * its indentation, line endings and key order. It changes the entry `dependencyVersion`
 * reads (`devDependencies` first, then `dependencies`); a new one goes into
 * `devDependencies`, in alphabetical order, as npm adds it.
 * @param root - The repo.
 * @param name - The package.
 * @param version - The version.
 * @throws KitError if package.json is missing or not a JSON object.
 * @example setDependency(root, "@ramon-sg/skills-manager", "1.2.0")
 */
export function setDependency(root: string, name: string, version: string): void {
  const pkg = readJson(root, "package.json");
  if (pkg === null) throw new KitError("no hay package.json.");
  const text = readFileSync(join(root, "package.json"), "utf8");
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const [deps, dev] = [pkg.dependencies, pkg.devDependencies];
  if (isObject(dev) && typeof dev[name] === "string") dev[name] = version;
  else if (isObject(deps) && typeof deps[name] === "string") deps[name] = version;
  else {
    const entries = Object.entries(isObject(dev) ? dev : {});
    const at = entries.findIndex(([key]) => key > name);
    entries.splice(at === -1 ? entries.length : at, 0, [name, version]);
    pkg.devDependencies = Object.fromEntries(entries);
  }
  const json = JSON.stringify(pkg, null, indent).replace(/\n/g, eol);
  writeFileSync(join(root, "package.json"), /\r?\n$/.test(text) || text === "" ? `${json}${eol}` : json);
}
