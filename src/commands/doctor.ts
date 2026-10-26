/**
 * @file `agent-kitchen doctor`: whether each piece the repo has works, with the doctor of each
 * tool at the repo's own version: the issue flow (and its skills at its tag),
 * `skills-manager check`, the version `.claude/cloud.json` pins, and claude-repo-guard. It
 * changes nothing. A piece the repo does not have, or a newer release, is only noted.
 */
import type { Output } from "../output.js";
import type { Check } from "../piece.js";
import { cloudChecks } from "../pieces/cloud.js";
import { guardChecks } from "../pieces/guard.js";
import { issueFlowChecks } from "../pieces/issue-flow.js";
import { skillsChecks } from "../pieces/skills.js";
import { mainCheckout } from "../repo.js";

/** The mark of each check's status. */
const MARKS: Record<Check["status"], string> = { ok: "✓", fail: "✗", info: "·" };

/**
 * Checks the repo; see the file's header.
 * @param cwd - Where it runs.
 * @param out - Where to write.
 * @returns 0 if nothing failed, 1 if something did.
 * @throws KitError outside a checkout or with a broken file.
 * @example doctor(process.cwd(), out)
 */
export function doctor(cwd: string, out: Output): number {
  const root = mainCheckout(cwd, "agent-kitchen doctor");
  const checks = [...issueFlowChecks(root), ...skillsChecks(root), ...cloudChecks(root), ...guardChecks(root)];
  for (const check of checks) out.stdout(`${MARKS[check.status]} ${check.name}: ${check.detail}\n`);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}
