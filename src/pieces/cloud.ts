/**
 * @file Claude cloud sessions (`@ramon-sg/claude-cloud`). The repo's version is the one
 * `.claude/cloud.json` pins: the cloud machine runs exactly that one. Installing runs its
 * `init`; updating only moves that version, which is how `claude-cloud` updates. Outside
 * the cloud its hook does nothing, so a repo nobody opens in the cloud loses nothing.
 */
import { warn } from "../output.js";
import type { Check, PieceStatus, Step } from "../piece.js";
import { readJson, writeJson } from "../repo.js";
import { compareVersions, isRelease, npmLatest, runNpx } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "claude-cloud";

/** The package on npm. */
const PACKAGE = "@ramon-sg/claude-cloud";

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
      label: `claude-cloud ${latest ?? "1.x"}: prepares Claude cloud sessions (${CONFIG})`,
      run: (context) => {
        if (runNpx(context.root, [spec, "init"])) return true;
        warn(context.out, `claude-cloud init failed; run 'npx ${spec} init'.`);
        return false;
      },
    };
  }
  if (latest === null || (version !== null && compareVersions(latest, version) <= 0)) return null;
  return {
    piece: NAME,
    checked: true,
    label: `claude-cloud ${version ?? "?"} → ${latest}: the version ${CONFIG} pins`,
    run: (context) => {
      writeJson(context.root, CONFIG, { ...(readJson(context.root, CONFIG) ?? {}), version: latest });
      return true;
    },
  };
}

/**
 * What the repo has of claude-cloud, and the step it needs.
 * @param root - The repo.
 * @returns The piece's status.
 * @example cloudStatus(root).state // "1.0.0, the latest"
 */
export function cloudStatus(root: string): PieceStatus {
  const config = readJson(root, CONFIG);
  const latest = npmLatest(PACKAGE);
  const version = pinned(config);
  const step = stepFor(config, latest);
  const known = latest === null ? " (npm cannot tell the latest)" : "";
  const state = config === null ? `not installed${known}` : version === null ? `${CONFIG} pins no version` : step === null ? `${version}${known}` : `${version}, ${latest ?? "?"} available`;
  return { name: NAME, summary: "Claude cloud sessions: tools, Docker and the full clone", state, steps: step === null ? [] : [step] };
}

/**
 * Whether `.claude/cloud.json` pins a version, and whether a newer one exists.
 * @param root - The repo.
 * @returns The checks.
 * @example cloudChecks(root)[0].status // "ok"
 */
export function cloudChecks(root: string): Check[] {
  const config = readJson(root, CONFIG);
  if (config === null) return [{ name: NAME, status: "info", detail: "not installed" }];
  const version = pinned(config);
  if (version === null) return [{ name: NAME, status: "fail", detail: `${CONFIG} pins no exact version; run 'npx ${PACKAGE}@1 init'` }];
  const latest = npmLatest(PACKAGE);
  if (latest !== null && compareVersions(latest, version) > 0) return [{ name: NAME, status: "info", detail: `${version}, ${latest} available: run npx @ramon-sg/agent-kit` }];
  return [{ name: NAME, status: "ok", detail: version }];
}
