/**
 * @file Claude cloud sessions (`@ramon-sg/claude-cloud`). The repo's version is the one
 * `.claude/cloud.json` pins: the cloud machine runs exactly that one. Installing runs its
 * `init`; updating only moves that version (and a `$schema` pinned to a version), which is
 * how `claude-cloud` updates. Outside
 * the cloud its hook does nothing, so a repo nobody opens in the cloud loses nothing.
 */
import type { Check, PieceStatus, Step } from "../piece.js";
import { readJson, writeJson } from "../repo.js";
import { compareVersions, isRelease, npmLatest, runNpx } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "claude-cloud";

/** The package on npm. */
export const PACKAGE = "@ramon-sg/claude-cloud";

/** Its config in the repo, which pins its version. */
const CONFIG = ".claude/cloud.json";

/**
 * The version `.claude/cloud.json` pins.
 * @param config - The config, or null.
 * @returns The version, or null if it has none.
 */
function pinned(config: Record<string, unknown> | null): string | null {
  return typeof config?.version === "string" && isRelease(config.version) ? config.version : null;
}

/**
 * The step the repo needs, if any.
 * @param config - The config, or null.
 * @param latest - The latest on npm, or null.
 * @returns The step, or null.
 */
function stepFor(config: Record<string, unknown> | null, latest: string | null): Step | null {
  const version = pinned(config);
  if (config === null) {
    const spec = `${PACKAGE}@${latest ?? "1"}`;
    return {
      piece: NAME,
      checked: true,
      downloads: [spec],
      label: `Instalar claude-cloud ${latest ?? "1.x"}: prepara las sesiones en la nube de Claude`,
      run: async (context) => {
        const run = await runNpx(context.root, [spec, "init"]);
        if (run.ok) return true;
        context.fail(`claude-cloud init falló; corre 'npx ${spec} init'.`, run.output);
        return false;
      },
    };
  }
  if (latest === null || (version !== null && compareVersions(latest, version) <= 0)) return null;
  return {
    piece: NAME,
    checked: true,
    downloads: [],
    label: `Actualizar claude-cloud ${version ?? "?"} → ${latest} (la versión que fija ${CONFIG})`,
    run: async (context) => {
      const current = readJson(context.root, CONFIG) ?? {};
      const schema = typeof current.$schema === "string" ? current.$schema.replace(/@ramon-sg\/claude-cloud@[^/]+\//, `${PACKAGE}@${latest}/`) : undefined;
      writeJson(context.root, CONFIG, { ...current, ...(schema === undefined ? {} : { $schema: schema }), version: latest });
      return true;
    },
  };
}

/**
 * What the repo has of claude-cloud, and the step it needs.
 * @param root - The repo.
 * @returns The piece's status.
 * @example (await cloudStatus(root)).state // "1.0.0, al día"
 */
export async function cloudStatus(root: string): Promise<PieceStatus> {
  const config = readJson(root, CONFIG);
  const latest = await npmLatest(PACKAGE);
  const version = pinned(config);
  const step = stepFor(config, latest);
  const known = latest === null ? " (npm no responde)" : "";
  const state = config === null ? `no instalado${known}` : version === null ? `${CONFIG} no fija versión` : step === null ? `${version}, al día${known}` : `${version}, hay ${latest ?? "?"}`;
  return { name: NAME, summary: "sesiones en la nube de Claude", installed: config !== null, state, steps: step === null ? [] : [step] };
}

/**
 * Whether `.claude/cloud.json` pins a version, and whether a newer one exists.
 * @param root - The repo.
 * @returns The checks.
 * @example (await cloudChecks(root))[0].status // "ok"
 */
export async function cloudChecks(root: string): Promise<Check[]> {
  const config = readJson(root, CONFIG);
  if (config === null) return [{ name: NAME, status: "info", detail: "no instalado" }];
  const version = pinned(config);
  const latest = await npmLatest(PACKAGE);
  if (version === null) return [{ name: NAME, status: "fail", detail: `${CONFIG} no fija una versión exacta: pon en "version" la que se usa, como "${latest ?? "1.0.0"}"` }];
  if (latest !== null && compareVersions(latest, version) > 0) return [{ name: NAME, status: "info", detail: `${version}, hay ${latest}: corre npx agent-kitchen` }];
  return [{ name: NAME, status: "ok", detail: version }];
}
