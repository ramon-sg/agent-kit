/**
 * @file The version of `skills-manager` in the repo's package.json. agent-kitchen runs it to
 * install and move the skills, so agent-kitchen is the one that knows the oldest version it
 * works with: it adds it when missing and raises an exact version below it, never lowers
 * one. A range or `workspace:` is the repo's own choice: it is left alone, with a warning if
 * the version it runs is too old. Only in a repo with package.json that uses skills.
 */
import { type Check, type Context, type PieceStatus, SKILLS_MANAGER, SKILLS_MANIFEST } from "../piece.js";
import { dependencyVersion, installedVersion, readJson, setDependency } from "../repo.js";
import { compareVersions, isRelease } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "skills-manager";

/** The oldest `skills-manager` agent-kitchen works with: the first with `--replace`. */
export const MIN_VERSION = "1.2.0";

/** What package.json has of skills-manager. */
type Pinned = { kind: "missing" } | { kind: "exact"; version: string } | { kind: "other"; spec: string; runs: string | null };

/**
 * What package.json has of skills-manager and, for a range, the version that runs: the one
 * in node_modules, or the first x.y.z of the range.
 * @param root - The repo.
 * @returns What it has.
 */
function pinned(root: string): Pinned {
  const spec = dependencyVersion(readJson(root, "package.json"), SKILLS_MANAGER);
  if (spec === null) return { kind: "missing" };
  if (isRelease(spec)) return { kind: "exact", version: spec };
  const floor = spec.startsWith("workspace:") ? null : (/\d+\.\d+\.\d+/.exec(spec)?.[0] ?? null);
  return { kind: "other", spec, runs: installedVersion(root, SKILLS_MANAGER) ?? floor };
}

/**
 * Whether a version is older than the one agent-kitchen needs.
 * @param version - The version.
 * @returns True if it is below the minimum.
 */
function below(version: string): boolean {
  return compareVersions(version, MIN_VERSION) < 0;
}

/**
 * Whether the piece applies: the repo has package.json and uses skills, or this run may
 * install them.
 * @param root - The repo.
 * @param withSkills - Whether this run may install skills (`skills` is not left out).
 * @returns True if it applies.
 */
function applies(root: string, withSkills: boolean): boolean {
  return readJson(root, "package.json") !== null && (withSkills || readJson(root, SKILLS_MANIFEST) !== null);
}

/**
 * What the repo has of skills-manager, and the step that raises it, if any. The step reads
 * package.json again when it runs.
 * @param root - The repo.
 * @param withSkills - Whether this run may install skills.
 * @returns The piece's status, or null where the piece does not apply.
 * @example skillsManagerStatus(root, true)?.state // "1.1.0, bajo 1.2.0"
 */
export function skillsManagerStatus(root: string, withSkills: boolean): PieceStatus | null {
  if (!applies(root, withSkills)) return null;
  const summary = "el CLI de las skills, que corre agent-kitchen";
  const now = pinned(root);
  if (now.kind === "other") {
    const old = now.runs !== null && below(now.runs) ? `; corre ${now.runs}, bajo ${MIN_VERSION}` : "";
    return { name: NAME, summary, installed: true, state: `package.json tiene ${now.spec}, no una versión exacta; no se toca${old}`, steps: [] };
  }
  if (now.kind === "exact" && !below(now.version)) return { name: NAME, summary, installed: true, state: `${now.version}, al día`, steps: [] };
  const label = now.kind === "missing" ? `Agregar skills-manager ${MIN_VERSION} a package.json` : `Subir skills-manager ${now.version} → ${MIN_VERSION}, el mínimo de agent-kitchen`;
  const state = now.kind === "missing" ? "no está en package.json" : `${now.version}, bajo ${MIN_VERSION}`;
  const step = {
    piece: NAME,
    checked: true,
    downloads: [`${SKILLS_MANAGER}@${MIN_VERSION}`],
    label,
    run: async (context: Context) => {
      const current = pinned(context.root);
      if (current.kind === "missing" || (current.kind === "exact" && below(current.version))) {
        setDependency(context.root, SKILLS_MANAGER, MIN_VERSION);
        context.note(`${SKILLS_MANAGER} ${MIN_VERSION} en package.json`);
      } else context.note("package.json ya tenía una versión que sirve");
      return true;
    },
  };
  return { name: NAME, summary, installed: now.kind !== "missing", state, steps: [step] };
}

/**
 * Whether the version of skills-manager the repo runs is the one agent-kitchen needs.
 * @param root - The repo.
 * @returns The checks; none where the piece does not apply.
 * @example skillsManagerChecks(root)[0]?.status // "ok"
 */
export function skillsManagerChecks(root: string): Check[] {
  if (!applies(root, false)) return [];
  const now = pinned(root);
  if (now.kind === "missing") return [{ name: NAME, status: "info", detail: `no está en package.json; corre npx agent-kitchen apply para fijar ${MIN_VERSION}` }];
  if (now.kind === "exact")
    return below(now.version)
      ? [{ name: NAME, status: "fail", detail: `${now.version}, bajo ${MIN_VERSION}, el mínimo de agent-kitchen: corre npx agent-kitchen apply` }]
      : [{ name: NAME, status: "ok", detail: `${now.version} (mínimo ${MIN_VERSION})` }];
  if (now.runs !== null && below(now.runs)) return [{ name: NAME, status: "fail", detail: `${now.spec} corre ${now.runs}, bajo ${MIN_VERSION}, el mínimo de agent-kitchen: sube el rango` }];
  return [{ name: NAME, status: "ok", detail: `${now.spec}${now.runs === null ? "" : `, corre ${now.runs}`}` }];
}
