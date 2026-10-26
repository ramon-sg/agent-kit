/**
 * @file The guardrails (`claude-repo-guard`): auto mode with the sandbox, installed in the
 * repo. It is not on npm, so it runs from GitHub at its `vX.Y.Z` tag; the repo's version is
 * the one its manifest records. Before installing or updating, agent-kit writes in its
 * options what the issue flow needs, if the repo has the flow: the auto mode is told that
 * the flow's writes are normal, the flow's base branch becomes `integrationBranch`, and on
 * macOS `weakerNetworkIsolation` lets `gh` work inside the sandbox (the guard's own default
 * is false, so false counts as missing; the step can be unticked). When the flow is
 * installed in the same run, the guard gets those options in that run too.
 */
import { type Output, warn } from "../output.js";
import { type Check, type Context, FLOW_CONFIG, type PieceStatus, type Step } from "../piece.js";
import { readJson, writeJson } from "../repo.js";
import { captureNpx, compareVersions, isRelease, latestTag, runNpx } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "claude-repo-guard";

/** Its GitHub repo. */
const REPO = "ramon-sg/claude-repo-guard";

/** Its options in the repo. */
const CONFIG = ".claude/repo-guard.config.json";

/** What its install records, with its version. */
const MANIFEST = ".claude/repo-guard.manifest.json";

/** What the auto mode is told about the issue flow. */
export const GUARD_ENVIRONMENT =
  "issue-flow is this repo's issue workflow: making the branch and worktree of an issue, its empty start commit, pushing it, opening its draft PR, assigning the issue and adding its \"Slug de rama\" block are normal steps of the work, not risky actions.";

/** The option that lets `gh` verify TLS inside the macOS sandbox. */
export const WEAKER_NETWORK = "weakerNetworkIsolation";

/**
 * The npx spec of a version.
 * @param version - The version, or null for the default branch.
 * @returns The spec.
 * @example guardSpec("0.2.0") // "github:ramon-sg/claude-repo-guard#v0.2.0"
 */
export function guardSpec(version: string | null): string {
  return version === null ? `github:${REPO}` : `github:${REPO}#v${version}`;
}

/**
 * The guard's options with what the flow needs added; what the repo set stays.
 * @param root - The repo.
 * @param platform - The operating system (`process.platform`).
 * @returns The new options and what changed.
 * @example guardOptions(root, "darwin").changes // [".claude/repo-guard.config.json: weakerNetworkIsolation true, …"]
 */
export function guardOptions(root: string, platform: string): { options: Record<string, unknown>; changes: string[] } {
  const options = { ...(readJson(root, CONFIG) ?? {}) };
  const changes: string[] = [];
  const flow = readJson(root, FLOW_CONFIG);
  const environment = Array.isArray(options.environment) ? options.environment.map(String) : [];
  if (flow !== null && !environment.includes(GUARD_ENVIRONMENT)) {
    options.environment = [...environment, GUARD_ENVIRONMENT];
    changes.push(`${CONFIG}: tells the auto mode about the issue flow`);
  }
  const baseBranch = typeof flow?.baseBranch === "string" ? flow.baseBranch : null;
  if (baseBranch !== null && (options.integrationBranch === undefined || options.integrationBranch === "")) {
    options.integrationBranch = baseBranch;
    changes.push(`${CONFIG}: integrationBranch ${baseBranch}`);
  }
  if (platform === "darwin" && options[WEAKER_NETWORK] !== true) {
    options[WEAKER_NETWORK] = true;
    changes.push(`${CONFIG}: ${WEAKER_NETWORK} true, so gh works inside the macOS sandbox`);
  }
  return { options, changes };
}

/**
 * Writes the flow's options and installs the guard at a version.
 * @param context - Where it runs.
 * @param version - The version, or null for the default branch.
 * @returns Whether it installed.
 */
function install(context: Context, version: string | null): boolean {
  const { options, changes } = guardOptions(context.root, process.platform);
  if (changes.length > 0) writeJson(context.root, CONFIG, options);
  for (const change of changes) context.out.stdout(`  ${change}\n`);
  if (runNpx(context.root, [guardSpec(version), "install", "--yes"])) return true;
  failed(context.out, version);
  return false;
}

/**
 * Writes the flow's options and reinstalls the guard at its version, if they are missing
 * by now (the flow may have been installed earlier in this run).
 * @param context - Where it runs.
 * @param version - The guard's version, or null.
 * @returns Whether it worked, or true if nothing was missing.
 */
function addOptions(context: Context, version: string | null): boolean {
  if (guardOptions(context.root, process.platform).changes.length > 0) return install(context, version);
  context.out.stdout("  its options already have what the issue flow needs\n");
  return true;
}

/**
 * Says how to retry an install that failed.
 * @param out - Where to write.
 * @param version - The version it tried.
 */
function failed(out: Output, version: string | null): void {
  warn(out, `claude-repo-guard did not install; run 'npx ${guardSpec(version)} install' from your terminal (inside a Claude session its sandbox blocks .claude/settings.json).`);
}

/**
 * The version its manifest records.
 * @param root - The repo.
 * @returns The version, null if it records none, or undefined if it is not installed.
 */
function installedVersion(root: string): string | null | undefined {
  const manifest = readJson(root, MANIFEST);
  if (manifest === null) return undefined;
  return typeof manifest.version === "string" && isRelease(manifest.version) ? manifest.version : null;
}

/**
 * The step the repo needs, if any.
 * @param root - The repo.
 * @param installed - The repo's version, null if unknown, undefined if not installed.
 * @param latest - The latest tag, or null.
 * @returns The step, or null.
 */
function stepFor(root: string, installed: string | null | undefined, latest: string | null, flowComing: boolean): Step | null {
  if (installed === undefined)
    return { piece: NAME, checked: true, label: `claude-repo-guard ${latest ?? "(main)"}: auto mode with the sandbox, and a doc of what it protects`, run: (context) => install(context, latest) };
  if (latest !== null && (installed === null || compareVersions(latest, installed) > 0))
    return { piece: NAME, checked: true, label: `claude-repo-guard ${installed ?? "?"} → ${latest}`, run: (context) => install(context, latest) };
  if (flowComing || guardOptions(root, process.platform).changes.length > 0)
    return { piece: NAME, checked: true, label: "claude-repo-guard: what the issue flow needs in its options", run: (context) => addOptions(context, installed) };
  return null;
}

/**
 * What the repo has of claude-repo-guard, and the step it needs.
 * @param root - The repo.
 * @param flowComing - Whether an earlier step of this run installs the issue flow.
 * @returns The piece's status.
 * @example guardStatus(root, false).state // "not installed"
 */
export function guardStatus(root: string, flowComing: boolean): PieceStatus {
  const installed = installedVersion(root);
  const latest = latestTag(REPO);
  const known = latest === null ? " (GitHub has no release tag)" : "";
  const state = installed === undefined ? `not installed${known}` : latest !== null && (installed === null || compareVersions(latest, installed) > 0) ? `${installed ?? "unknown version"}, ${latest} available` : `${installed ?? "unknown version"}${known}`;
  const step = stepFor(root, installed, latest, flowComing);
  return { name: NAME, summary: "guardrails: auto mode with the sandbox, writes only inside the worktree", installed: installed !== undefined, state, steps: step === null ? [] : [step] };
}

/**
 * The guard's own doctor at the repo's version and, on macOS, the option `gh` needs.
 * @param root - The repo.
 * @returns The checks.
 * @example guardChecks(root).map((check) => check.status) // ["ok"]
 */
export function guardChecks(root: string): Check[] {
  const installed = installedVersion(root);
  if (installed === undefined) return [{ name: NAME, status: "info", detail: "not installed (Claude opens with your own permissions)" }];
  const checks: Check[] = [];
  if (process.platform === "darwin" && readJson(root, CONFIG)?.[WEAKER_NETWORK] !== true)
    checks.push({ name: `${NAME}: ${WEAKER_NETWORK}`, status: "fail", detail: `not true in ${CONFIG}, so gh fails inside the macOS sandbox: run npx @ramon-sg/agent-kit` });
  const result = captureNpx(root, [guardSpec(installed), "doctor", "--json"]);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    found = null;
  }
  if (!Array.isArray(found)) return [...checks, { name: NAME, status: "fail", detail: `could not run its doctor; run 'npx ${guardSpec(installed)} doctor'` }];
  const bad = found.filter((check: unknown) => typeof check !== "object" || check === null || (check as { ok?: unknown }).ok !== true);
  if (bad.length === 0) return [...checks, { name: NAME, status: "ok", detail: `${installed ?? "unknown version"}, its doctor passes` }];
  return [...checks, ...bad.map((check: unknown) => {
    const entry = typeof check === "object" && check !== null ? (check as { name?: unknown; detail?: unknown }) : { name: "?", detail: String(check) };
    return { name: `${NAME}: ${String(entry.name)}`, status: "fail" as const, detail: String(entry.detail) };
  })];
}
