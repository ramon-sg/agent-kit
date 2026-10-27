/**
 * @file How agent-kitchen reaches the other tools and their releases: `npx` to run them (always
 * by their scoped name or GitHub spec, because the unscoped names on npm belong to other
 * people), `npm view` for the latest version on npm, and `git ls-remote` for the latest
 * `vX.Y.Z` tag on GitHub. Everything is asynchronous so the lookups run at the same time,
 * and each lookup runs once per process. A lookup that fails, or takes over 20 seconds,
 * gives null: the piece is shown, not offered. git never asks for credentials here.
 *
 * The tools run quietly: their output is kept and shown only when they fail, so the person
 * reads one line per step. `--verbose` shows it as it comes.
 */
import { spawn } from "node:child_process";

/** A release version. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** How long a lookup of the latest version may take before it counts as unknown. */
const LOOKUP_TIMEOUT_MS = 20_000;

/** A release tag in `git ls-remote --tags --refs` output. */
const TAG_REF = /refs\/tags\/v(\d+\.\d+\.\d+)$/;

/** How many lines of a failed tool's output are shown. */
const FAILED_LINES = 25;

/** Whether the tools' output goes straight to the terminal. */
let verbose = false;

/** Lookups already started, by what they look up. */
const lookups = new Map<string, Promise<string | null>>();

/** Downloads already started, by package. */
const downloads = new Map<string, Promise<void>>();

/** What a process printed and how it ended. */
interface Finished {
  status: number | null;
  out: string;
  err: string;
}

/**
 * Shows the tools' output as it comes instead of only when they fail.
 * @param value - True for `--verbose`.
 * @example setVerbose(true)
 */
export function setVerbose(value: boolean): void {
  verbose = value;
}

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
 * Runs a program and collects what it prints.
 * @param program - The program.
 * @param args - Its arguments.
 * @param options - The folder, a time limit, extra variables, and whether its output goes to the terminal.
 * @returns How it ended; status null if it could not start or ran out of time.
 */
function run(program: string, args: string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; inherit?: boolean } = {}): Promise<Finished> {
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: options.inherit === true ? "inherit" : ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (err += chunk.toString()));
    const timer = options.timeout === undefined ? undefined : setTimeout(() => child.kill(), options.timeout);
    child.on("error", () => resolve({ status: null, out, err }));
    child.on("close", (code, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ status: signal === null ? code : null, out, err });
    });
  });
}

/**
 * Runs a lookup once: later calls get the same promise.
 * @param key - What it looks up.
 * @param lookup - How.
 * @returns Its result.
 */
function once(key: string, lookup: () => Promise<string | null>): Promise<string | null> {
  const known = lookups.get(key);
  if (known !== undefined) return known;
  const started = lookup();
  lookups.set(key, started);
  return started;
}

/**
 * The latest version of a package on npm.
 * @param name - The package.
 * @returns The version, or null if npm cannot tell.
 * @example await npmLatest("@ramon-sg/claude-cloud") // "1.0.0"
 */
export function npmLatest(name: string): Promise<string | null> {
  return once(`npm:${name}`, async () => {
    const result = await run("npm", ["view", name, "version", "--fetch-retries=0"], { timeout: LOOKUP_TIMEOUT_MS });
    const version = result.status === 0 ? result.out.trim() : "";
    return isRelease(version) ? version : null;
  });
}

/**
 * The highest `vX.Y.Z` tag of a GitHub repo.
 * @param repo - The repo, as owner/name.
 * @returns The version without the `v`, or null if it has none or git cannot reach it.
 * @example await latestTag("ramon-sg/agent-skills") // "0.1.0"
 */
export function latestTag(repo: string): Promise<string | null> {
  return once(`tag:${repo}`, async () => {
    const result = await run("git", ["ls-remote", "--tags", "--refs", `https://github.com/${repo}.git`], { timeout: LOOKUP_TIMEOUT_MS, env: { GIT_TERMINAL_PROMPT: "0" } });
    if (result.status !== 0) return null;
    const versions = result.out.split("\n").flatMap((line) => TAG_REF.exec(line.trim())?.slice(1, 2) ?? []);
    return versions.sort(compareVersions).at(-1) ?? null;
  });
}

/**
 * Downloads a package into npx's cache without running it, once per package, so its step
 * starts at once. A failed download is ignored: the step itself will say what failed.
 * @param root - The repo.
 * @param spec - The package, as npx takes it.
 * @returns When it is done.
 * @example void download(root, "@ramon-sg/claude-cloud@1.0.0")
 */
export function download(root: string, spec: string): Promise<void> {
  const known = downloads.get(spec);
  if (known !== undefined) return known;
  const started = run("npx", ["--yes", "--package", spec, "--", "node", "-e", ""], { cwd: root }).then(() => undefined);
  downloads.set(spec, started);
  return started;
}

/** How a tool ended, and what it printed if it was kept. */
export interface ToolRun {
  ok: boolean;
  output: string;
}

/**
 * Runs `npx --yes <args>` in the repo: quietly, or with its output on the terminal with
 * `--verbose`. It must not ask anything: the person answered before the steps ran.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @returns Whether it exited 0, and what it printed.
 * @example await runNpx(root, ["@ramon-sg/claude-cloud@1.0.0", "init"])
 */
export async function runNpx(root: string, args: string[]): Promise<ToolRun> {
  const result = await run("npx", ["--yes", ...args], { cwd: root, inherit: verbose });
  return { ok: result.status === 0, output: `${result.out}${result.err}` };
}

/**
 * The end of a failed tool's output, indented, to show under its step.
 * @param output - What it printed.
 * @returns Its last lines, or an empty text.
 * @example failedOutput("npm error 404\n") // "    npm error 404\n"
 */
export function failedOutput(output: string): string {
  const lines = output.trimEnd().split("\n").filter((line) => line.trim() !== "");
  return lines.slice(-FAILED_LINES).map((line) => `    ${line}\n`).join("");
}

/**
 * Runs `npx --yes <args>` in the repo and returns what it printed on stdout.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @param lookup - True to give up after the lookups' time limit, for a read that only informs.
 * @returns Its stdout and exit code, or null if npx could not start.
 * @example await captureNpx(root, ["@ramon-sg/issue-flow@0.2.0", "doctor", "--json"])
 */
export async function captureNpx(root: string, args: string[], lookup = false): Promise<{ out: string; status: number | null } | null> {
  const result = await run("npx", ["--yes", ...args], { cwd: root, ...(lookup ? { timeout: LOOKUP_TIMEOUT_MS } : {}) });
  return result.status === null && result.out === "" ? null : { out: result.out, status: result.status };
}
