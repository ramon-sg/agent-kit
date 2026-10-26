/**
 * @file The skills, through `skills-manager`: the flow's catalog (pinned to the flow's
 * version, because its skills call the CLI) and the general catalogs (each skill at its
 * own tag). The first time it opens the `skills-manager` menu with every catalog. Later it
 * offers to move the general skills to their catalog's latest tag, and, unticked, to pick
 * the skills a catalog has that the repo does not take yet. The flow's skills move with the
 * flow (pieces/issue-flow.ts), never here.
 */
import { warn } from "../output.js";
import { type Check, type Context, FLOW_CATALOG, GENERAL_CATALOGS, type PieceStatus, SKILLS_MANIFEST, type Step } from "../piece.js";
import { readJson } from "../repo.js";
import { catalogSkills, lockedSkills, manifestCatalogs, pinCatalog, skillsManagerSpec, updateSkills } from "../skills-files.js";
import { captureNpx, compareVersions, latestTag, runNpx } from "../tools.js";
import { flowVersion } from "./issue-flow.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "skills";

/** The skills picked without a terminal: the flow's, and the audit `close-pr` uses. */
const DEFAULT_SKILLS = [
  ...["github-issues", "start-issue", "close-pr", "pr-review-comments", "pr-worktree"].map((name) => `catalog:${FLOW_CATALOG}/${name}`),
  "catalog:ramon-sg/agent-skills/code-audit",
];

/** A release tag. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/**
 * The `--catalog` flags: the flow's at the repo's flow version, if the repo has the flow,
 * and the general ones.
 * @param root - The repo.
 * @returns The flags.
 */
function catalogArgs(root: string): string[] {
  const flow = flowVersion(root);
  const catalogs = [...(flow === null ? [] : [`${FLOW_CATALOG}#v${flow}`]), ...GENERAL_CATALOGS];
  return catalogs.flatMap((catalog) => ["--catalog", catalog]);
}

/**
 * The default skills the manifest does not take yet, of the catalogs offered.
 * @param root - The repo.
 * @returns Their ids.
 */
function missingDefaults(root: string): string[] {
  const manifest = readJson(root, SKILLS_MANIFEST);
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  const taken = new Set(sources.flatMap((source: { catalog?: unknown; skills?: unknown }) => (typeof source.catalog === "string" && Array.isArray(source.skills) ? source.skills.map((name) => `catalog:${String(source.catalog)}/${String(name)}`) : [])));
  const flow = flowVersion(root) !== null;
  return DEFAULT_SKILLS.filter((id) => !taken.has(id) && (flow || !id.startsWith(`catalog:${FLOW_CATALOG}/`)));
}

/**
 * Opens the `skills-manager` menu with the catalogs; without a terminal or with `--yes`,
 * picks the default skills the repo does not have yet.
 * @param context - Where it runs.
 * @returns Whether `skills-manager` worked, or true if there was nothing to pick.
 */
function pick(context: Context): boolean {
  const spec = skillsManagerSpec(context.root);
  const args = [spec, readJson(context.root, SKILLS_MANIFEST) === null ? "init" : "add", ...catalogArgs(context.root)];
  const choose = context.yes || !context.out.interactive;
  const missing = choose ? missingDefaults(context.root) : [];
  if (choose && missing.length === 0) {
    context.out.stdout(`  the default skills are already in ${SKILLS_MANIFEST}\n`);
    return true;
  }
  if (runNpx(context.root, choose ? [...args, "--select", missing.join(",")] : args)) return true;
  warn(context.out, `skills-manager did not install the skills; run 'npx ${args.join(" ")}'.`);
  return false;
}

/**
 * The step that moves a general catalog's skills to its latest tag, if they are behind. A
 * catalog that follows a branch has no tag to move to, so it gets no step.
 * @param root - The repo.
 * @param catalog - The catalog.
 * @param ref - The ref the manifest pins it to, or null.
 * @returns The step, or null.
 */
function updateStep(root: string, catalog: string, ref: string | null): Step | null {
  if (ref !== null && !RELEASE_TAG.test(ref)) return null;
  const latest = latestTag(catalog);
  if (latest === null) return null;
  const behind = catalogSkills(root, catalog).filter((skill) => skill.tag !== null && RELEASE_TAG.test(skill.tag) && compareVersions(latest, skill.tag.replace(/^v/, "")) > 0);
  if (behind.length === 0) return null;
  const from = [...new Set(behind.map((skill) => skill.tag ?? "?"))].join(", ");
  return {
    piece: NAME,
    checked: true,
    label: `${catalog}: ${behind.map((skill) => skill.name).join(", ")} ${from} → v${latest}`,
    run: (context) => {
      if (ref !== null) pinCatalog(context.root, catalog, `v${latest}`);
      const failed = updateSkills(context.root, behind.map((skill) => skill.name));
      if (failed === null) return true;
      warn(context.out, `skills-manager did not update ${catalog}; run '${failed}' and then agent-kit again.`);
      return false;
    },
  };
}

/**
 * The skills the catalogs have and the repo does not take, as `skills-manager` lists them,
 * without those already in the lock (it lists the ones that came through `requires`).
 * @param root - The repo.
 * @returns Their names, or null if `skills-manager` could not tell.
 */
function newSkills(root: string): string[] | null {
  const result = captureNpx(root, [skillsManagerSpec(root), "add", "--candidates", ...catalogArgs(root)]);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    return null;
  }
  if (!Array.isArray(found)) return null;
  const locked = lockedSkills(root);
  return found.map((candidate: { name?: unknown }) => String(candidate.name)).filter((name) => locked[name] === undefined);
}

/**
 * What the repo has of the skills, and the steps it can take.
 * @param root - The repo.
 * @returns The piece's status.
 * @example skillsStatus(root).state // "6 installed"
 */
export function skillsStatus(root: string): PieceStatus {
  const summary = "skills: the flow's, planning, code and test audits";
  if (readJson(root, SKILLS_MANIFEST) === null) {
    const label = `skills: pick them from ${[FLOW_CATALOG, ...GENERAL_CATALOGS].join(" and ")} (without a terminal, the flow's and code-audit)`;
    return { name: NAME, summary, installed: false, state: "not installed", steps: [{ piece: NAME, checked: true, label, run: pick }] };
  }
  const general = manifestCatalogs(root).filter((source) => source.catalog !== FLOW_CATALOG);
  const steps = general.flatMap((source) => updateStep(root, source.catalog, source.ref) ?? []);
  const fresh = newSkills(root);
  if (fresh !== null && fresh.length > 0) steps.push({ piece: NAME, checked: false, label: `skills: ${fresh.length} more to pick (${fresh.join(", ")})`, run: pick });
  const count = manifestCatalogs(root).reduce((total, source) => total + catalogSkills(root, source.catalog).length, 0);
  const behind = steps.filter((step) => step.checked).length;
  return { name: NAME, summary, installed: true, state: `${count} installed${behind > 0 ? ", some behind" : ""}`, steps };
}

/**
 * Whether `skills-manager check` passes: disk, lock and manifest agree.
 * @param root - The repo.
 * @returns The checks.
 * @example skillsChecks(root)[0].status // "ok"
 */
export function skillsChecks(root: string): Check[] {
  if (readJson(root, SKILLS_MANIFEST) === null) return [{ name: NAME, status: "info", detail: "not installed" }];
  const spec = skillsManagerSpec(root);
  const result = captureNpx(root, [spec, "check"]);
  if (result?.status === 0) return [{ name: NAME, status: "ok", detail: "skills-manager check passes" }];
  return [{ name: NAME, status: "fail", detail: `disk, lock and manifest disagree: run 'npx ${spec} check'` }];
}
