/**
 * @file `agent-kitchen [--yes] [--dry-run] [--skip <piece>,...]`: the one command. It looks at
 * each piece (the issue flow, claude-cloud, claude-repo-guard, the skills), shows what the
 * repo has and the latest of each, and offers the steps that install what is missing or
 * update what is behind. In a terminal the person unticks what they do not want; with
 * `--yes` it runs the ticked ones; without a terminal it only shows them. The steps run in
 * order (the flow first, the skills last, since they follow the flow's version) and one that
 * fails does not stop the rest.
 */
import { askSteps } from "../menu.js";
import { KitError, type Output, UsageError, warn } from "../output.js";
import type { PieceStatus, Step } from "../piece.js";
import { cloudStatus, NAME as CLOUD } from "../pieces/cloud.js";
import { guardStatus, NAME as GUARD } from "../pieces/guard.js";
import { issueFlowStatus, NAME as FLOW } from "../pieces/issue-flow.js";
import { NAME as SKILLS, skillsStatus } from "../pieces/skills.js";
import { mainCheckout, packageManager } from "../repo.js";

/** Options of the command. */
export interface SyncOptions {
  cwd: string;
  yes: boolean;
  dryRun: boolean;
  skip: string[];
}

/** What a piece's status gets: the repo, and the statuses of the pieces before it. */
type StatusOf = (root: string, before: PieceStatus[]) => PieceStatus;

/** Every piece, in the order its steps run. */
const PIECES: { name: string; status: StatusOf }[] = [
  { name: FLOW, status: issueFlowStatus },
  { name: CLOUD, status: cloudStatus },
  { name: GUARD, status: (root, before) => guardStatus(root, before.some((status) => status.name === FLOW && !status.installed && status.steps.length > 0)) },
  { name: SKILLS, status: skillsStatus },
];

/**
 * The names `--skip` takes.
 * @returns The pieces' names.
 * @example pieceNames() // ["issue-flow", "claude-cloud", "claude-repo-guard", "skills"]
 */
export function pieceNames(): string[] {
  return PIECES.map((piece) => piece.name);
}

/**
 * Prints what the repo has of each piece.
 * @param statuses - The pieces' statuses.
 * @param out - Where to write.
 */
function printStatus(statuses: PieceStatus[], out: Output): void {
  const width = Math.max(...statuses.map((status) => status.name.length));
  out.stdout("This repo has:\n");
  for (const status of statuses) out.stdout(`  ${status.name.padEnd(width)}  ${status.state}  · ${status.summary}\n`);
}

/**
 * The steps to run: the ticked ones with `--yes`, the picked ones in a terminal, or none.
 * @param steps - The steps offered.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The steps, or null if nothing should run.
 */
async function chooseSteps(steps: Step[], options: SyncOptions, out: Output): Promise<Step[] | null> {
  if (options.yes) return steps.filter((step) => step.checked);
  if (options.dryRun || !out.interactive) {
    out.stdout(`It would offer${options.dryRun ? "" : " (run it in a terminal to pick, or with --yes)"}:\n${steps.map((step) => `  [${step.checked ? "x" : " "}] ${step.label}\n`).join("")}`);
    return null;
  }
  const picked = await askSteps(steps);
  if (picked === null) warn(out, "cancelled; nothing changed.");
  return picked;
}

/**
 * Runs the command; see the file's header.
 * @param options - The options.
 * @param out - Where to write and ask.
 * @returns 0, or 1 if a step failed or the person cancelled.
 * @throws KitError outside the main checkout or with a broken file; UsageError for an unknown piece.
 * @example await sync({ cwd, yes: false, dryRun: true, skip: [] }, out)
 */
export async function sync(options: SyncOptions, out: Output): Promise<number> {
  const unknown = options.skip.find((name) => !pieceNames().includes(name));
  if (unknown !== undefined) throw new UsageError(`unknown piece ${unknown}; there are ${pieceNames().join(", ")}.`);
  if (options.yes && options.dryRun) throw new UsageError("use --yes or --dry-run, not both.");
  const root = mainCheckout(options.cwd, "agent-kitchen");
  const statuses: PieceStatus[] = [];
  for (const piece of PIECES.filter((item) => !options.skip.includes(item.name))) statuses.push(piece.status(root, statuses));
  printStatus(statuses, out);
  const steps = statuses.flatMap((status) => status.steps);
  if (steps.length === 0) {
    out.stdout("Nothing to install or update.\n");
    return 0;
  }
  const chosen = await chooseSteps(steps, options, out);
  if (chosen === null) return options.dryRun || !out.interactive ? 0 : 1;
  if (chosen.length === 0) {
    out.stdout("Nothing picked; nothing changed.\n");
    return 0;
  }
  const failed: string[] = [];
  for (const step of chosen) {
    out.stdout(`\n→ ${step.label}\n`);
    let ok: boolean;
    try {
      ok = step.run({ root, yes: options.yes || !out.interactive, out });
    } catch (error) {
      if (!(error instanceof KitError)) throw error;
      warn(out, error.message);
      ok = false;
    }
    if (!ok) failed.push(step.label);
  }
  out.stdout(`\n${failed.length === 0 ? "Done." : `Done, but these failed: ${failed.join("; ")}.`} Next: run '${packageManager(root)} install', review the diff and commit it.\n`);
  return failed.length === 0 ? 0 : 1;
}
