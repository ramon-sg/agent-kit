/**
 * @file The issue flow (`@ramon-sg/issue-flow`): its CLI, hooks and config, and its skills.
 * The repo's version is the one in package.json. Installing runs its `init` at the latest
 * version; updating runs its `upgrade` at the new one and then moves its skills to the same
 * tag, because the skills call the CLI. If only the skills are off, it moves them alone.
 */
import { warn } from "../output.js";
import { type Check, type Context, FLOW_CATALOG, FLOW_PACKAGE, type PieceStatus, type Step } from "../piece.js";
import { dependencyVersion, readJson } from "../repo.js";
import { catalogSkills, manifestCatalogs, pinCatalog, updateSkills } from "../skills-files.js";
import { captureNpx, compareVersions, isRelease, npmLatest, runNpx } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "issue-flow";

/** How the catalog's ref is named when it is off. */
const SKILLS_CATALOG_LABEL = "the catalog";

/** The first version whose `doctor` prints `--json`. */
const JSON_DOCTOR = "0.2.0";

/**
 * The issue flow's version in the repo, as package.json has it: an exact release when the
 * flow set it up, or anything else (a range, a `file:` link) someone wrote by hand.
 * @param root - The repo.
 * @returns The version in package.json, or null.
 * @example flowVersion(root) // "0.2.0"
 */
export function flowSpec(root: string): string | null {
  return dependencyVersion(readJson(root, "package.json"), FLOW_PACKAGE);
}

/**
 * The issue flow's release in the repo: what package.json pins, if it is an exact release.
 * @param root - The repo.
 * @returns The version, or null if there is none or it is not a release.
 * @example flowVersion(root) // "0.2.0"
 */
export function flowVersion(root: string): string | null {
  const spec = flowSpec(root);
  return spec !== null && isRelease(spec) ? spec : null;
}

/**
 * The flow's skills that are not at a version's tag, or the catalog pinned elsewhere.
 * @param root - The repo.
 * @param version - The flow's version.
 * @returns Their names; the catalog's ref as well if it is off.
 */
function skillsOff(root: string, version: string): string[] {
  const tag = `v${version}`;
  const off = catalogSkills(root, FLOW_CATALOG).filter((skill) => skill.tag !== tag).map((skill) => `${skill.name} at ${skill.tag ?? "no tag"}`);
  const source = manifestCatalogs(root).find((item) => item.catalog === FLOW_CATALOG);
  return source !== undefined && source.ref !== tag ? [...off, `${SKILLS_CATALOG_LABEL} at ${source.ref ?? "the latest"}`] : off;
}

/**
 * Moves the flow's skills to a version's tag: the catalog's ref in the manifest, and then
 * `skills-manager update` on them.
 * @param context - Where it runs.
 * @param version - The flow's version.
 * @returns Whether it worked, or true if the repo has none of the flow's skills.
 */
function moveSkills(context: Context, version: string): boolean {
  if (!pinCatalog(context.root, FLOW_CATALOG, `v${version}`)) return true;
  const failed = updateSkills(context.root, catalogSkills(context.root, FLOW_CATALOG).map((skill) => skill.name));
  if (failed === null) return true;
  warn(context.out, `skills-manager did not update the flow's skills; run '${failed}' and then agent-kitchen again.`);
  return false;
}

/**
 * Runs the flow's own command at a version.
 * @param context - Where it runs.
 * @param version - The version.
 * @param args - The command and its flags.
 * @returns Whether it exited 0.
 */
function runFlow(context: Context, version: string, args: string[]): boolean {
  if (runNpx(context.root, [`${FLOW_PACKAGE}@${version}`, ...args])) return true;
  warn(context.out, `issue-flow ${args[0] ?? ""} failed; run 'npx ${FLOW_PACKAGE}@${version} ${args.join(" ")}'.`);
  return false;
}

/**
 * The step the repo needs, if any.
 * @param installed - The repo's version, or null.
 * @param latest - The latest on npm, or null.
 * @param root - The repo.
 * @returns The step, or null.
 */
function stepFor(installed: string | null, latest: string | null, root: string): Step | null {
  if (installed === null && latest !== null)
    return { piece: NAME, checked: true, label: `issue-flow ${latest}: .agents/flow.json with its recipes, the hooks and scripts`, run: (context) => runFlow(context, latest, ["init", ...(context.yes ? ["--yes"] : [])]) };
  if (installed !== null && latest !== null && compareVersions(latest, installed) > 0)
    return { piece: NAME, checked: true, label: `issue-flow ${installed} → ${latest}: the CLI, its hooks and its skills`, run: (context) => runFlow(context, latest, ["upgrade"]) && moveSkills(context, latest) };
  if (installed !== null && skillsOff(root, installed).length > 0)
    return { piece: NAME, checked: true, label: `issue-flow's skills → v${installed}, the CLI's version`, run: (context) => moveSkills(context, installed) };
  return null;
}

/**
 * What the repo has of the issue flow, and the step it needs.
 * @param root - The repo.
 * @returns The piece's status.
 * @example issueFlowStatus(root).state // "0.1.0, 0.2.0 available"
 */
export function issueFlowStatus(root: string): PieceStatus {
  const summary = "the issue flow: branch, worktree and draft PR per issue, and its skills";
  const spec = flowSpec(root);
  if (spec !== null && !isRelease(spec)) return { name: NAME, summary, installed: true, state: `package.json has ${spec}, not an exact release; agent-kitchen leaves it`, steps: [] };
  const installed = flowVersion(root);
  const latest = npmLatest(FLOW_PACKAGE);
  const step = stepFor(installed, latest, root);
  const known = latest === null ? " (npm cannot tell the latest)" : "";
  const state = installed === null ? `not installed${known}` : latest !== null && compareVersions(latest, installed) > 0 ? `${installed}, ${latest} available` : `${installed}${known}`;
  return { name: NAME, summary, installed: installed !== null, state, steps: step === null ? [] : [step] };
}

/**
 * The flow's own doctor at the repo's version, and whether its skills are at that tag.
 * @param root - The repo.
 * @returns The checks.
 * @example issueFlowChecks(root)[0].name // "issue-flow: .agents/flow.json"
 */
export function issueFlowChecks(root: string): Check[] {
  const spec = flowSpec(root);
  if (spec === null) return [{ name: NAME, status: "info", detail: "not installed" }];
  const installed = flowVersion(root);
  if (installed === null) return [{ name: NAME, status: "info", detail: `package.json has ${spec}, not an exact release` }];
  if (compareVersions(installed, JSON_DOCTOR) < 0) return [{ name: NAME, status: "info", detail: `${installed} predates its doctor --json: run npx agent-kitchen to update it` }];
  const result = captureNpx(root, [`${FLOW_PACKAGE}@${installed}`, "doctor", "--json"]);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    found = null;
  }
  const own: Check[] = Array.isArray(found)
    ? found.map((check: { name?: unknown; ok?: unknown; detail?: unknown }) => ({ name: `${NAME}: ${String(check.name)}`, status: check.ok === true ? "ok" : "fail", detail: String(check.detail) }))
    : [{ name: NAME, status: "fail", detail: `could not run its doctor; run 'npx ${FLOW_PACKAGE}@${installed} doctor'` }];
  const off = skillsOff(root, installed);
  const count = catalogSkills(root, FLOW_CATALOG).length;
  const skills: Check = count === 0 && off.length === 0
    ? { name: `${NAME}: skills`, status: "info", detail: "none installed" }
    : off.length === 0
    ? { name: `${NAME}: skills`, status: "ok", detail: `${count} at v${installed}` }
    : { name: `${NAME}: skills`, status: "fail", detail: `${off.join(", ")}, the CLI is ${installed}: run npx agent-kitchen` };
  return [...own, skills];
}
