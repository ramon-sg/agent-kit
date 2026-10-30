/**
 * @file The issue flow (`@ramon-sg/issue-flow`): its CLI, hooks and config, and its skills.
 * The repo's version is the one in package.json. Installing runs its `init` at the latest
 * version; updating runs its `upgrade` at the new one and then moves its skills to the same
 * tag, because the skills call the CLI. If only the skills are off, it moves them alone.
 * `init` runs with `--yes`: the person answered agent-kitchen's questions before the steps.
 */
import { type Check, type Context, FLOW_CATALOG, FLOW_PACKAGE, type PieceStatus, type Step } from "../piece.js";
import { dependencyVersion, readJson } from "../repo.js";
import { catalogSkills, manifestCatalogs, pinCatalog, updateSkills } from "../skills-files.js";
import { captureNpx, compareVersions, isRelease, npmLatest, runNpx } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "issue-flow";

/** How the catalog's ref is named when it is off. */
const SKILLS_CATALOG_LABEL = "el catálogo";

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
  const off = catalogSkills(root, FLOW_CATALOG).filter((skill) => skill.tag !== tag).map((skill) => `${skill.name} en ${skill.tag ?? "sin tag"}`);
  const source = manifestCatalogs(root).find((item) => item.catalog === FLOW_CATALOG);
  return source !== undefined && source.ref !== tag ? [...off, `${SKILLS_CATALOG_LABEL} en ${source.ref ?? "la última"}`] : off;
}

/**
 * Moves the flow's skills to a version's tag: the catalog's ref in the manifest, and then
 * `skills-manager update` on them.
 * @param context - Where it runs.
 * @param version - The flow's version.
 * @returns Whether it worked, or true if the repo has none of the flow's skills.
 */
async function moveSkills(context: Context, version: string): Promise<boolean> {
  if (!pinCatalog(context.root, FLOW_CATALOG, `v${version}`)) return true;
  const names = catalogSkills(context.root, FLOW_CATALOG).map((skill) => skill.name);
  const failed = await updateSkills(context.root, names);
  if (failed === null) {
    context.note(`skills del flujo en v${version}: ${names.join(", ")}`);
    return true;
  }
  context.fail(`skills-manager no actualizó las skills del flujo; corre '${failed.command}' y luego agent-kitchen apply otra vez.`, failed.run.output);
  return false;
}

/**
 * Runs the flow's own command at a version.
 * @param context - Where it runs.
 * @param version - The version.
 * @param args - The command and its flags.
 * @returns Whether it exited 0.
 */
async function runFlow(context: Context, version: string, args: string[]): Promise<boolean> {
  const run = await runNpx(context.root, [`${FLOW_PACKAGE}@${version}`, ...args]);
  if (run.ok) return true;
  context.fail(`issue-flow ${args[0] ?? ""} falló; corre 'npx ${FLOW_PACKAGE}@${version} ${args.join(" ")}'.`, run.output);
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
    return { piece: NAME, checked: true, downloads: [`${FLOW_PACKAGE}@${latest}`], label: `Instalar issue-flow ${latest}: config del flujo, hooks y scripts`, run: (context) => runFlow(context, latest, ["init", "--yes"]) };
  if (installed !== null && latest !== null && compareVersions(latest, installed) > 0)
    return { piece: NAME, checked: true, downloads: [`${FLOW_PACKAGE}@${latest}`], label: `Actualizar issue-flow ${installed} → ${latest}, con sus hooks y sus skills`, run: async (context) => (await runFlow(context, latest, ["upgrade"])) && (await moveSkills(context, latest)) };
  if (installed !== null && skillsOff(root, installed).length > 0)
    return { piece: NAME, checked: true, downloads: [], label: `Poner las skills del flujo en v${installed}, la versión de issue-flow`, run: (context) => moveSkills(context, installed) };
  return null;
}

/**
 * What the repo has of the issue flow, and the step it needs.
 * @param root - The repo.
 * @returns The piece's status.
 * @example (await issueFlowStatus(root)).state // "0.1.0, hay 0.2.0"
 */
export async function issueFlowStatus(root: string): Promise<PieceStatus> {
  const summary = "rama, worktree y PR en draft por issue";
  const spec = flowSpec(root);
  if (spec !== null && !isRelease(spec)) return { name: NAME, summary, installed: true, state: `package.json tiene ${spec}, no una versión exacta; no se toca`, steps: [] };
  const installed = flowVersion(root);
  const latest = await npmLatest(FLOW_PACKAGE);
  const step = stepFor(installed, latest, root);
  const known = latest === null ? " (npm no responde)" : "";
  const state = installed === null ? `no instalado${known}` : latest !== null && compareVersions(latest, installed) > 0 ? `${installed}, hay ${latest}` : `${installed}, al día${known}`;
  return { name: NAME, summary, installed: installed !== null, state, steps: step === null ? [] : [step] };
}

/**
 * The flow's own doctor at the repo's version, and whether its skills are at that tag.
 * @param root - The repo.
 * @returns The checks.
 * @example (await issueFlowChecks(root))[0].name // "issue-flow: .agents/flow.json"
 */
export async function issueFlowChecks(root: string): Promise<Check[]> {
  const spec = flowSpec(root);
  if (spec === null) return [{ name: NAME, status: "info", detail: "no instalado" }];
  const installed = flowVersion(root);
  if (installed === null) return [{ name: NAME, status: "info", detail: `package.json tiene ${spec}, no una versión exacta` }];
  if (compareVersions(installed, JSON_DOCTOR) < 0) return [{ name: NAME, status: "info", detail: `${installed} no tiene doctor --json: corre npx agent-kitchen apply para actualizarlo` }];
  const result = await captureNpx(root, [`${FLOW_PACKAGE}@${installed}`, "doctor", "--json"]);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    found = null;
  }
  const own: Check[] = Array.isArray(found)
    ? found.map((check: { name?: unknown; ok?: unknown; detail?: unknown }) => ({ name: `${NAME}: ${String(check.name)}`, status: check.ok === true ? "ok" : "fail", detail: String(check.detail) }))
    : [{ name: NAME, status: "fail", detail: `no se pudo correr su doctor; corre 'npx ${FLOW_PACKAGE}@${installed} doctor'` }];
  const off = skillsOff(root, installed);
  const count = catalogSkills(root, FLOW_CATALOG).length;
  const skills: Check = count === 0 && off.length === 0
    ? { name: `${NAME}: skills`, status: "info", detail: "ninguna instalada" }
    : off.length === 0
    ? { name: `${NAME}: skills`, status: "ok", detail: `${count} en v${installed}` }
    : { name: `${NAME}: skills`, status: "fail", detail: `${off.join(", ")}; issue-flow está en ${installed}: corre npx agent-kitchen apply` };
  return [...own, skills];
}
