/**
 * @file How agent-kitchen reaches the other tools and their releases: `npx` to run them (always
 * by their scoped name or GitHub spec, because the unscoped names on npm belong to other
 * people), `npm view` for the latest version on npm, and `git ls-remote` for the latest
 * `vX.Y.Z` tag on GitHub. A lookup that fails, or takes over 20 seconds, gives null: the
 * piece is shown, not offered. git never asks for credentials here.
 */
import { spawnSync } from "node:child_process";

/** A release version. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** How long a lookup of the latest version may take before it counts as unknown. */
const LOOKUP_TIMEOUT_MS = 20_000;

/** A release tag in `git ls-remote --tags --refs` output. */
const TAG_REF = /refs\/tags\/v(\d+\.\d+\.\d+)$/;

/**
 * Compares two release versions.
 * @param left - A version like 0.2.0.
 * @param right - Another.
 * @returns Negative if left is older, 0 if equal, positive if newer.
 * @example compareVersions("0.10.0", "0.9.1") // 1
 */
export function compareVersions(left: string, right: string): number {
  const parts = (version: string): number[] => (VERSION.exec(version) ?? []).slice(1).map(Number);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether a version is a release like 1.2.3.
 * @param version - The text.
 * @returns True for a release version.
 * @example isRelease("1.2.3") // true
 */
export function isRelease(version: string): boolean {
  return VERSION.test(version);
}

/**
 * Runs `npx --yes <args>` in the repo, with its output and questions on this terminal.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @returns Whether it exited 0.
 * @example runNpx(root, ["@ramon-sg/claude-cloud@1.0.0", "init"])
 */
export function runNpx(root: string, args: string[]): boolean {
  return spawnSync("npx", ["--yes", ...args], { cwd: root, stdio: "inherit" }).status === 0;
}

/**
 * Runs `npx --yes <args>` in the repo and returns what it printed.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @returns Its stdout and exit code, or null if npx could not start.
 * @example captureNpx(root, ["@ramon-sg/issue-flow@0.2.0", "doctor", "--json"])
 */
export function captureNpx(root: string, args: string[]): { out: string; status: number | null } | null {
  const result = spawnSync("npx", ["--yes", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return result.error === undefined ? { out: result.stdout, status: result.status } : null;
}

/**
 * The latest version of a package on npm.
 * @param name - The package.
 * @returns The version, or null if npm cannot tell.
 * @example npmLatest("@ramon-sg/claude-cloud") // "1.0.0"
 */
export function npmLatest(name: string): string | null {
  const result = spawnSync("npm", ["view", name, "version", "--fetch-retries=0"], { encoding: "utf8", timeout: LOOKUP_TIMEOUT_MS });
  const version = result.status === 0 ? result.stdout.trim() : "";
  return isRelease(version) ? version : null;
}

/**
 * The highest `vX.Y.Z` tag of a GitHub repo.
 * @param repo - The repo, as owner/name.
 * @returns The version without the `v`, or null if it has none or git cannot reach it.
 * @example latestTag("ramon-sg/agent-skills") // "0.1.0"
 */
export function latestTag(repo: string): string | null {
  const result = spawnSync("git", ["ls-remote", "--tags", "--refs", `https://github.com/${repo}.git`], { encoding: "utf8", timeout: LOOKUP_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (result.status !== 0) return null;
  const versions = result.stdout.split("\n").flatMap((line) => TAG_REF.exec(line.trim())?.slice(1, 2) ?? []);
  return versions.sort(compareVersions).at(-1) ?? null;
}
