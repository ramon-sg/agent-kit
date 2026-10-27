/**
 * @file The skills, through `skills-manager`: the flow's catalog (pinned to the flow's
 * version, because its skills call the CLI) and the general catalogs (each skill at its
 * own tag). agent-kitchen reads what the catalogs offer (`--candidates`), lets the person
 * pick before any step runs, and then installs the pick with `--select`, so
 * `skills-manager` asks nothing. The first time every skill comes ticked. Later it offers
 * to move the general skills to their catalog's latest tag, and, unticked, the skills a
 * catalog has that the repo does not take yet. The flow's skills move with the flow
 * (pieces/issue-flow.ts), never here.
 *
 * A skill the repo already has as its own (a folder the lock does not know) is replaced
 * only if the person allows it (`--replace`); `skills-manager` keeps its `project.md`.
 */
import { type Candidate, type Check, type Context, FLOW_CATALOG, FLOW_PACKAGE, GENERAL_CATALOGS, type PieceStatus, SKILLS_MANIFEST, type SkillPick, type Step } from "../piece.js";
import { isObject, readJson } from "../repo.js";
import { catalogSkills, lockedSkills, manifestCatalogs, ownSkills, pinCatalog, skillsManagerSpec, updateSkills } from "../skills-files.js";
import { captureNpx, compareVersions, latestTag, npmLatest, runNpx } from "../tools.js";
import { flowVersion } from "./issue-flow.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "skills";

/** The skills picked when the catalogs cannot be read: the flow's, and the audit `close-pr` uses. */
const DEFAULT_SKILLS = [
  ...["github-issues", "start-issue", "close-pr", "pr-review-comments", "pr-worktree"].map((name) => `catalog:${FLOW_CATALOG}/${name}`),
  "catalog:ramon-sg/agent-skills/code-audit",
];

/** A release tag. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/**
 * The `--catalog` flags: the flow's at a version, if there is one, and the general ones.
 * @param flow - The flow's version, or null.
 * @returns The flags.
 */
function catalogArgs(flow: string | null): string[] {
  const catalogs = [...(flow === null ? [] : [`${FLOW_CATALOG}#v${flow}`]), ...GENERAL_CATALOGS];
  return catalogs.flatMap((catalog) => ["--catalog", catalog]);
}

/**
 * Reads one candidate of `--candidates`.
 * @param value - An item of its output.
 * @returns The candidate, or null if it is not one.
 */
function toCandidate(value: unknown): Candidate | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const names = (field: unknown): string[] => (Array.isArray(field) ? field.map(String) : []);
  return {
    id: value.id,
    name: value.name,
    catalog: typeof value.catalog === "string" ? value.catalog : "",
    description: typeof value.description === "string" ? value.description : "",
    skills: [...names(value.skills), ...names(value.requires)],
  };
}

/**
 * What the catalogs offer that the manifest does not take yet, as `skills-manager` lists it.
 * @param root - The repo.
 * @param flow - The flow's version whose catalog to read, or null.
 * @returns The candidates, or null if `skills-manager` could not tell.
 */
async function readCandidates(root: string, flow: string | null): Promise<Candidate[] | null> {
  const command = readJson(root, SKILLS_MANIFEST) === null ? "init" : "add";
  const result = await captureNpx(root, [skillsManagerSpec(root), command, "--candidates", ...catalogArgs(flow)]);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    return null;
  }
  if (!Array.isArray(found)) return null;
  return found.flatMap((item) => toCandidate(item) ?? []);
}

/**
 * The repo's own skills a pick would replace: each picked skill and what it requires.
 * @param root - The repo.
 * @param pick - The pick.
 * @returns Their names.
 * @example ownInPick(root, step.skills) // ["planning"]
 */
export function ownInPick(root: string, pick: SkillPick): string[] {
  const names = pick.candidates.filter((candidate) => pick.picked.includes(candidate.id)).flatMap((candidate) => candidate.skills);
  return ownSkills(root, names);
}

/**
 * Drops from a pick the skills that would replace one of the repo's own (or that require
 * one), for when the person does not allow replacing them.
 * @param pick - The pick.
 * @param own - The repo's own skills that stay.
 * @returns The pick without them.
 * @example keepOwn(pick, ["planning"]).picked
 */
export function keepOwn(pick: SkillPick, own: string[]): SkillPick {
  const clashing = new Set(pick.candidates.filter((candidate) => candidate.skills.some((name) => own.includes(name))).map((candidate) => candidate.id));
  return { ...pick, picked: pick.picked.filter((id) => !clashing.has(id)), replace: [] };
}

/**
 * Installs the picked skills with `--select`, replacing the own ones the person allowed.
 * @param context - Where it runs.
 * @param pick - What to install.
 * @returns Whether `skills-manager` worked, or true if nothing was picked.
 */
async function install(context: Context, pick: SkillPick): Promise<boolean> {
  if (pick.picked.length === 0) {
    context.note("ninguna skill elegida");
    return true;
  }
  const spec = skillsManagerSpec(context.root);
  const command = readJson(context.root, SKILLS_MANIFEST) === null ? "init" : "add";
  const args = [spec, command, ...catalogArgs(flowVersion(context.root)), "--select", pick.picked.join(","), ...(pick.replace.length === 0 ? [] : ["--replace", pick.replace.join(",")])];
  const run = await runNpx(context.root, args);
  if (!run.ok) {
    context.fail(`skills-manager no instaló las skills; corre 'npx ${args.join(" ")}'.`, run.output);
    return false;
  }
  const names = pick.candidates.filter((candidate) => pick.picked.includes(candidate.id)).map((candidate) => candidate.name);
  context.note(names.length === 0 ? `${pick.picked.length} skills` : names.join(", "));
  if (pick.replace.length > 0) context.note(`reemplazadas (con su project.md): ${pick.replace.join(", ")}`);
  return true;
}

/**
 * The step that moves a general catalog's skills to its latest tag, if they are behind. A
 * catalog that follows a branch has no tag to move to, so it gets no step.
 * @param root - The repo.
 * @param catalog - The catalog.
 * @param ref - The ref the manifest pins it to, or null.
 * @returns The step, or null.
 */
async function updateStep(root: string, catalog: string, ref: string | null): Promise<Step | null> {
  if (ref !== null && !RELEASE_TAG.test(ref)) return null;
  const latest = await latestTag(catalog);
  if (latest === null) return null;
  const behind = catalogSkills(root, catalog).filter((skill) => skill.tag !== null && RELEASE_TAG.test(skill.tag) && compareVersions(latest, skill.tag.replace(/^v/, "")) > 0);
  if (behind.length === 0) return null;
  const from = [...new Set(behind.map((skill) => skill.tag ?? "?"))].join(", ");
  return {
    piece: NAME,
    checked: true,
    downloads: [skillsManagerSpec(root)],
    label: `Actualizar skills de ${catalog} ${from} → v${latest}: ${behind.map((skill) => skill.name).join(", ")}`,
    run: async (context) => {
      if (ref !== null) pinCatalog(context.root, catalog, `v${latest}`);
      const failed = await updateSkills(context.root, behind.map((skill) => skill.name));
      if (failed === null) return true;
      context.fail(`skills-manager no actualizó ${catalog}; corre '${failed.command}' y luego agent-kitchen otra vez.`, failed.run.output);
      return false;
    },
  };
}

/**
 * The flow's version whose catalog to offer: the repo's, or the latest when the repo does
 * not have the flow yet (it is installed before the skills), unless the flow is left out.
 * @param root - The repo.
 * @param withFlow - Whether this run may install the flow.
 * @returns The version, or null if there is none.
 */
async function offeredFlow(root: string, withFlow: boolean): Promise<string | null> {
  return flowVersion(root) ?? (withFlow ? await npmLatest(FLOW_PACKAGE) : null);
}

/**
 * What the repo has of the skills, and the steps it can take.
 * @param root - The repo.
 * @param withFlow - Whether this run may install the flow (it is not left out with `--skip`).
 * @returns The piece's status.
 * @example (await skillsStatus(root, true)).state // "6 instaladas"
 */
export async function skillsStatus(root: string, withFlow: boolean): Promise<PieceStatus> {
  const summary = "skills del flujo, planes y auditorías";
  const candidatesRead = readCandidates(root, await offeredFlow(root, withFlow));
  if (readJson(root, SKILLS_MANIFEST) === null) {
    const candidates = await candidatesRead;
    const offered = candidates ?? DEFAULT_SKILLS.map((id) => ({ id, name: id.split("/").at(-1) ?? id, catalog: "", description: "", skills: [id.split("/").at(-1) ?? id] }));
    const label = `Instalar ${offered.length} skills de ${[FLOW_CATALOG, ...GENERAL_CATALOGS].join(" y ")}`;
    const skills = { candidates: offered, picked: offered.map((candidate) => candidate.id), replace: [] };
    return { name: NAME, summary, installed: false, state: "no instaladas", steps: [{ piece: NAME, checked: true, downloads: [skillsManagerSpec(root)], label, skills, run: (context) => install(context, skills) }] };
  }
  const general = manifestCatalogs(root).filter((source) => source.catalog !== FLOW_CATALOG);
  const steps = (await Promise.all(general.map((source) => updateStep(root, source.catalog, source.ref)))).flatMap((step) => step ?? []);
  const locked = lockedSkills(root);
  const fresh = ((await candidatesRead) ?? []).filter((candidate) => locked[candidate.name] === undefined);
  if (fresh.length > 0) {
    const skills: SkillPick = { candidates: fresh, picked: [], replace: [] };
    steps.push({ piece: NAME, checked: false, downloads: [skillsManagerSpec(root)], label: `Agregar skills nuevas (${fresh.length}): ${fresh.map((candidate) => candidate.name).join(", ")}`, skills, run: (context) => install(context, skills) });
  }
  const count = manifestCatalogs(root).reduce((total, source) => total + catalogSkills(root, source.catalog).length, 0);
  const behind = steps.filter((step) => step.checked).length;
  return { name: NAME, summary, installed: true, state: `${count} instaladas${behind > 0 ? ", algunas atrasadas" : ", al día"}`, steps };
}

/**
 * Whether `skills-manager check` passes: disk, lock and manifest agree.
 * @param root - The repo.
 * @returns The checks.
 * @example (await skillsChecks(root))[0].status // "ok"
 */
export async function skillsChecks(root: string): Promise<Check[]> {
  if (readJson(root, SKILLS_MANIFEST) === null) return [{ name: NAME, status: "info", detail: "no instaladas" }];
  const spec = skillsManagerSpec(root);
  const result = await captureNpx(root, [spec, "check"]);
  if (result?.status === 0) return [{ name: NAME, status: "ok", detail: "skills-manager check pasa" }];
  return [{ name: NAME, status: "fail", detail: `el disco, el lock y el manifiesto no coinciden: corre 'npx ${spec} check'` }];
}
