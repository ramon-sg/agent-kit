/**
 * @file The guardrails (`claude-repo-guard`): auto mode with the sandbox, installed in the
 * repo. It is not on npm, so it runs from GitHub at its `vX.Y.Z` tag; the repo's version is
 * the one its manifest records. Before installing or updating, agent-kitchen writes in its
 * options what the issue flow needs, if the repo has the flow: the auto mode is told that
 * the flow's writes are normal, the flow's base branch becomes `integrationBranch`, and on
 * macOS `weakerNetworkIsolation` lets `gh` work inside the sandbox (the guard's own default
 * is false, so false counts as missing; the step can be unticked). When the flow is
 * installed in the same run, the guard gets those options in that run too.
 *
 * Its command that installs or updates is `apply` since 0.5.0 and `install` before, so the
 * command follows the version being run. If it fails, its own output is shown; the hint about
 * Claude's sandbox is added only when that output is a permission error, which is how the
 * sandbox's block on `.claude/settings.json` shows up.
 */
import { type Check, type Context, FLOW_CONFIG, type PieceStatus, type Step } from "../piece.js";
import { readJson, writeJson } from "../repo.js";
import { captureNpx, compareVersions, isRelease, latestTag, runNpx } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "claude-repo-guard";

/** Its GitHub repo. */
export const REPO = "ramon-sg/claude-repo-guard";

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

/** The first version whose install command is `apply`. */
const APPLY_SINCE = "0.5.0";

/** What a write blocked by a sandbox or by the file's permissions prints. */
const PERMISSION_ERROR = /\b(EPERM|EACCES|EROFS)\b|operation not permitted|permission denied|read-only file system/i;

/**
 * The guard's command that installs or updates, at a version.
 * @param version - The version, or null for the default branch.
 * @returns `apply` from 0.5.0 on and on the default branch, `install` before.
 * @example guardCommand("0.4.1") // "install"
 */
export function guardCommand(version: string | null): string {
  return version === null || compareVersions(version, APPLY_SINCE) >= 0 ? "apply" : "install";
}

/**
 * What to say when the guard did not install.
 * @param version - The version it ran.
 * @param output - What it printed.
 * @returns One line: the command to run by hand, and the sandbox hint only if the output is a permission error.
 * @example guardFailure("0.5.1", "Error: EPERM: operation not permitted") // "…sandbox…"
 */
export function guardFailure(version: string | null, output: string): string {
  const command = `npx ${guardSpec(version)} ${guardCommand(version)}`;
  if (PERMISSION_ERROR.test(output))
    return `claude-repo-guard no se instaló: no tuvo permiso para escribir en el repo. Si corres agent-kitchen dentro de una sesión de Claude, su sandbox bloquea .claude/settings.json; corre '${command}' desde tu terminal.`;
  return `claude-repo-guard no se instaló; su error está abajo. Para reintentar a mano: '${command}'.`;
}

/**
 * The guard's options with what the flow needs added; what the repo set stays.
 * @param root - The repo.
 * @param platform - The operating system (`process.platform`).
 * @returns The new options and what changed.
 * @example guardOptions(root, "darwin").changes // ["weakerNetworkIsolation activado, …"]
 */
export function guardOptions(root: string, platform: string): { options: Record<string, unknown>; changes: string[] } {
  const options = { ...(readJson(root, CONFIG) ?? {}) };
  const changes: string[] = [];
  const flow = readJson(root, FLOW_CONFIG);
  const environment = Array.isArray(options.environment) ? options.environment.map(String) : [];
  if (flow !== null && !environment.includes(GUARD_ENVIRONMENT)) {
    options.environment = [...environment, GUARD_ENVIRONMENT];
    changes.push("le explica el flujo de issues al modo auto");
  }
  const baseBranch = typeof flow?.baseBranch === "string" ? flow.baseBranch : null;
  if (baseBranch !== null && (options.integrationBranch === undefined || options.integrationBranch === "")) {
    options.integrationBranch = baseBranch;
    changes.push(`rama de integración ${baseBranch}`);
  }
  if (platform === "darwin" && options[WEAKER_NETWORK] !== true) {
    options[WEAKER_NETWORK] = true;
    changes.push(`${WEAKER_NETWORK} activado, para que gh funcione en el sandbox de macOS`);
  }
  return { options, changes };
}

/**
 * Writes the flow's options and installs the guard at a version.
 * @param context - Where it runs.
 * @param version - The version, or null for the default branch.
 * @returns Whether it installed.
 */
async function install(context: Context, version: string | null): Promise<boolean> {
  const { options, changes } = guardOptions(context.root, process.platform);
  if (changes.length > 0) writeJson(context.root, CONFIG, options);
  for (const change of changes) context.note(change);
  const run = await runNpx(context.root, [guardSpec(version), guardCommand(version), "--yes"]);
  if (run.ok) return true;
  context.fail(guardFailure(version, run.output), run.output);
  return false;
}

/**
 * Writes the flow's options and reinstalls the guard at its version, if they are missing
 * by now (the flow may have been installed earlier in this run).
 * @param context - Where it runs.
 * @param version - The guard's version, or null.
 * @returns Whether it worked, or true if nothing was missing.
 */
async function addOptions(context: Context, version: string | null): Promise<boolean> {
  if (guardOptions(context.root, process.platform).changes.length > 0) return install(context, version);
  context.note("sus opciones ya tienen lo que necesita el flujo");
  return true;
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
    return { piece: NAME, checked: true, downloads: [guardSpec(latest)], label: `Instalar claude-repo-guard ${latest ?? "(main)"}: modo auto con sandbox, y un documento de qué protege`, run: (context) => install(context, latest) };
  if (latest !== null && (installed === null || compareVersions(latest, installed) > 0))
    return { piece: NAME, checked: true, downloads: [guardSpec(latest)], label: `Actualizar claude-repo-guard ${installed ?? "?"} → ${latest}`, run: (context) => install(context, latest) };
  if (flowComing || guardOptions(root, process.platform).changes.length > 0)
    return { piece: NAME, checked: true, downloads: [guardSpec(installed)], label: "Ajustar claude-repo-guard a lo que necesita el flujo de issues", run: (context) => addOptions(context, installed) };
  return null;
}

/**
 * What the repo has of claude-repo-guard, and the step it needs.
 * @param root - The repo.
 * @param flowComing - Whether an earlier step of this run installs the issue flow.
 * @returns The piece's status.
 * @example (await guardStatus(root, false)).state // "no instalado"
 */
export async function guardStatus(root: string, flowComing: boolean): Promise<PieceStatus> {
  const installed = installedVersion(root);
  const latest = await latestTag(REPO);
  const known = latest === null ? " (GitHub no tiene una versión)" : "";
  const state = installed === undefined ? `no instalado${known}` : latest !== null && (installed === null || compareVersions(latest, installed) > 0) ? `${installed ?? "versión desconocida"}, hay ${latest}` : `${installed ?? "versión desconocida"}, al día${known}`;
  const step = stepFor(root, installed, latest, flowComing);
  return { name: NAME, summary: "barandas: modo auto con sandbox", installed: installed !== undefined, state, steps: step === null ? [] : [step] };
}

/**
 * The guard's own doctor at the repo's version and, on macOS, the option `gh` needs.
 * @param root - The repo.
 * @returns The checks.
 * @example (await guardChecks(root)).map((check) => check.status) // ["ok"]
 */
export async function guardChecks(root: string): Promise<Check[]> {
  const installed = installedVersion(root);
  if (installed === undefined) return [{ name: NAME, status: "info", detail: "no instalado (Claude se abre con tus propios permisos)" }];
  const checks: Check[] = [];
  if (process.platform === "darwin" && readJson(root, CONFIG)?.[WEAKER_NETWORK] !== true)
    checks.push({ name: `${NAME}: ${WEAKER_NETWORK}`, status: "fail", detail: `no está activado en ${CONFIG}, así que gh falla en el sandbox de macOS: corre npx agent-kitchen apply` });
  const result = await captureNpx(root, [guardSpec(installed), "doctor", "--json"]);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    found = null;
  }
  if (!Array.isArray(found)) return [...checks, { name: NAME, status: "fail", detail: `no se pudo correr su doctor; corre 'npx ${guardSpec(installed)} doctor'` }];
  const bad = found.filter((check: unknown) => typeof check !== "object" || check === null || (check as { ok?: unknown }).ok !== true);
  if (bad.length === 0) return [...checks, { name: NAME, status: "ok", detail: `${installed ?? "versión desconocida"}, su doctor pasa` }];
  return [...checks, ...bad.map((check: unknown) => {
    const entry = typeof check === "object" && check !== null ? (check as { name?: unknown; detail?: unknown }) : { name: "?", detail: String(check) };
    return { name: `${NAME}: ${String(entry.name)}`, status: "fail" as const, detail: String(entry.detail) };
  })];
}
