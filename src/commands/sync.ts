/**
 * @file `agent-kitchen [--yes] [--dry-run] [--verbose] [--skip <piece>,...]`: the one command.
 * It looks at each piece (the issue flow, claude-cloud, claude-repo-guard, the skills, the
 * rule in AGENTS.md) with
 * every lookup at once, shows what the repo has, and offers the steps that install what is
 * missing or update what is behind. In a terminal it asks first, all in one go: everything
 * suggested, or pick the steps and the skills; whether to replace the repo's own skills.
 * While the person answers, the tools download. Then the steps run in order (the flow
 * first, the skills last, since they follow the flow's version), one line each, with the
 * tools' output only when one fails; one that fails does not stop the rest. With `--yes`
 * it does what is suggested without asking (and keeps the repo's own skills); without a
 * terminal it only shows the steps.
 */
import { spinner } from "@clack/prompts";
import { askPath, askReplace, askSkills, askSteps } from "../menu.js";
import { KitError, type Output, UsageError, warn } from "../output.js";
import type { Context, PieceStatus, Step } from "../piece.js";
import { cloudStatus, NAME as CLOUD } from "../pieces/cloud.js";
import { guardStatus, NAME as GUARD } from "../pieces/guard.js";
import { issueFlowStatus, NAME as FLOW } from "../pieces/issue-flow.js";
import { keepOwn, NAME as SKILLS, ownInPick, skillsStatus } from "../pieces/skills.js";
import { agentsMdStatus, NAME as AGENTS_MD } from "../pieces/agents-md.js";
import { mainCheckout, packageManager } from "../repo.js";
import { download, failedOutput, setVerbose } from "../tools.js";

/** Options of the command. */
export interface SyncOptions {
  cwd: string;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
  skip: string[];
}

/** Every piece, in the order its steps run. */
const PIECES = [FLOW, CLOUD, GUARD, SKILLS, AGENTS_MD];

/** How a step's progress is shown: a spinner in a terminal, plain lines otherwise. */
interface Progress {
  start: (text: string) => void;
  stop: (text: string, ok: boolean) => void;
}

/**
 * The names `--skip` takes.
 * @returns The pieces' names.
 * @example pieceNames() // ["issue-flow", "claude-cloud", "claude-repo-guard", "skills", "agents-md"]
 */
export function pieceNames(): string[] {
  return [...PIECES];
}

/**
 * Each piece's status, with every lookup at once. The guard's step and the rule in AGENTS.md
 * depend on whether the flow is about to be installed (it writes package.json), so they wait
 * for the flow's status.
 * @param root - The repo.
 * @param skip - The pieces left out.
 * @returns The statuses, in the pieces' order.
 */
async function statusesOf(root: string, skip: string[]): Promise<PieceStatus[]> {
  const flow = skip.includes(FLOW) ? null : issueFlowStatus(root);
  const cloud = skip.includes(CLOUD) ? null : cloudStatus(root);
  const skills = skip.includes(SKILLS) ? null : skillsStatus(root, !skip.includes(FLOW));
  const flowComing = (flow ?? Promise.resolve(null)).then((status) => status !== null && !status.installed && status.steps.length > 0);
  const guard = skip.includes(GUARD) ? null : flowComing.then((coming) => guardStatus(root, coming));
  const agentsMd = skip.includes(AGENTS_MD) ? null : flowComing.then((coming) => agentsMdStatus(root, coming));
  const all = await Promise.all([flow, cloud, guard, skills, agentsMd]);
  return all.flatMap((status) => status ?? []);
}

/**
 * Prints what the repo has of each piece.
 * @param statuses - The pieces' statuses.
 * @param out - Where to write.
 */
function printStatus(statuses: PieceStatus[], out: Output): void {
  const width = Math.max(...statuses.map((status) => status.name.length));
  const stateWidth = Math.max(...statuses.map((status) => status.state.length));
  out.stdout("\nEste repo tiene:\n");
  for (const status of statuses) out.stdout(`  ${status.name.padEnd(width)}  ${status.state.padEnd(stateWidth)}  · ${status.summary}\n`);
  out.stdout("\n");
}

/**
 * Leaves the repo's own skills out of a step's pick, saying so.
 * @param root - The repo.
 * @param step - A step that installs skills.
 * @param out - Where to write.
 */
function keepOwnSkills(root: string, step: Step, out: Output): void {
  if (step.skills === undefined) return;
  const own = ownInPick(root, step.skills);
  if (own.length === 0) return;
  Object.assign(step.skills, keepOwn(step.skills, own));
  out.stdout(`Se dejan fuera las skills que el repo ya tiene como propias: ${own.join(", ")}. Para reemplazarlas, corre agent-kitchen en una terminal.\n`);
}

/**
 * Asks, for a step that installs skills, which ones, and whether to replace the repo's own.
 * @param root - The repo.
 * @param step - The step.
 * @param chooseSkills - Whether to show the skills menu, or keep the step's pick.
 * @returns False if the person cancelled.
 */
async function askAboutSkills(root: string, step: Step, chooseSkills: boolean): Promise<boolean> {
  const pick = step.skills;
  if (pick === undefined) return true;
  if (chooseSkills) {
    const picked = await askSkills(pick.candidates, pick.picked.length > 0 ? pick.picked : pick.candidates.map((candidate) => candidate.id));
    if (picked === null) return false;
    pick.picked = picked;
  }
  const own = ownInPick(root, pick);
  if (own.length === 0) return true;
  const replace = await askReplace(own);
  if (replace === null) return false;
  if (replace) pick.replace = own;
  else Object.assign(pick, keepOwn(pick, own));
  return true;
}

/**
 * The steps to run: the suggested ones with `--yes`, what the person picks in a terminal,
 * or none (only shown) with `--dry-run` or without a terminal.
 * @param root - The repo.
 * @param steps - The steps offered.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The steps, "leave" if the person chose to leave, or null if nothing should run (only shown, or cancelled).
 */
async function chooseSteps(root: string, steps: Step[], options: SyncOptions, out: Output): Promise<Step[] | "leave" | null> {
  const suggested = steps.filter((step) => step.checked);
  if (options.yes) {
    if (suggested.length === 0) out.stdout(`Todo al día. Opcional, para elegir en una terminal: ${steps.map((step) => step.label).join("; ")}.\n`);
    for (const step of suggested) keepOwnSkills(root, step, out);
    return suggested;
  }
  if (options.dryRun || !out.interactive) {
    const hint = options.dryRun ? "" : " (para hacerlos, corre agent-kitchen en una terminal, o con --yes)";
    out.stdout(`Pasos sugeridos${hint}:\n${steps.map((step) => `  [${step.checked ? "x" : " "}] ${step.label}\n`).join("")}`);
    return null;
  }
  for (const step of suggested) for (const spec of step.downloads) void download(root, spec);
  const path = await askPath(suggested.length);
  if (path === "leave") return "leave";
  const chosen = path === "all" ? suggested : await askSteps(steps);
  if (chosen === null) return null;
  for (const step of chosen) {
    if (!(await askAboutSkills(root, step, path === "pick"))) return null;
  }
  return chosen;
}

/**
 * How progress is shown: a spinner in a terminal (unless the tools print with
 * `--verbose`), plain lines otherwise. Only for the steps, after every question: a spinner
 * shown before a question leaves the second question deaf to the keyboard (@clack/prompts
 * 1.8.1).
 * @param out - Where to write.
 * @param verbose - Whether the tools print on the terminal.
 * @returns The progress.
 */
function progressFor(out: Output, verbose: boolean): Progress {
  if (out.interactive && !verbose) {
    const spin = spinner();
    return { start: (text) => spin.start(text), stop: (text, ok) => (ok ? spin.stop(text) : spin.error(text)) };
  }
  return { start: (text) => out.stdout(`→ ${text}\n`), stop: (text, ok) => out.stdout(`${ok ? "✓" : "✗"} ${text}\n`) };
}

/**
 * Runs one step and shows how it went: its notes, and what to do if it failed.
 * @param root - The repo.
 * @param step - The step.
 * @param progress - How progress is shown.
 * @param out - Where to write.
 * @returns Whether it worked.
 * @throws What the step throws that is not a KitError.
 */
async function runStep(root: string, step: Step, progress: Progress, out: Output): Promise<boolean> {
  const notes: string[] = [];
  const failures: string[] = [];
  const context: Context = {
    root,
    note: (text) => notes.push(text),
    fail: (text, output) => failures.push(`  ${text}\n${output === undefined ? "" : failedOutput(output)}`),
  };
  progress.start(step.label);
  await Promise.all(step.downloads.map((spec) => download(root, spec)));
  let ok: boolean;
  try {
    ok = await step.run(context);
  } catch (error) {
    if (!(error instanceof KitError)) throw error;
    failures.push(`  ${error.message}\n`);
    ok = false;
  }
  progress.stop(step.label, ok);
  for (const note of notes) out.stdout(`  · ${note}\n`);
  for (const failure of failures) out.stderr(failure);
  return ok;
}

/**
 * Runs the command; see the file's header.
 * @param options - The options.
 * @param out - Where to write and ask.
 * @returns 0, or 1 if a step failed or the person cancelled.
 * @throws KitError outside the main checkout or with a broken file; UsageError for an unknown piece.
 * @example await sync({ cwd, yes: false, dryRun: true, verbose: false, skip: [] }, out)
 */
export async function sync(options: SyncOptions, out: Output): Promise<number> {
  const unknown = options.skip.find((name) => !pieceNames().includes(name));
  if (unknown !== undefined) throw new UsageError(`no existe la pieza ${unknown}; son ${pieceNames().join(", ")}.`);
  if (options.yes && options.dryRun) throw new UsageError("usa --yes o --dry-run, no los dos.");
  const root = mainCheckout(options.cwd, "agent-kitchen");
  setVerbose(options.verbose);
  if (out.interactive) out.stdout("Revisando el repo y las últimas versiones…\n");
  const statuses = await statusesOf(root, options.skip);
  printStatus(statuses, out);
  const steps = statuses.flatMap((status) => status.steps);
  if (steps.length === 0) {
    out.stdout("Todo al día: no hay nada que instalar ni actualizar.\n");
    return 0;
  }
  const chosen = await chooseSteps(root, steps, options, out);
  if (chosen === "leave") {
    out.stdout("No se cambió nada.\n");
    return 0;
  }
  if (chosen === null) {
    if (!options.dryRun && out.interactive) warn(out, "no se cambió nada.");
    return options.dryRun || !out.interactive ? 0 : 1;
  }
  if (chosen.length === 0) {
    if (!options.yes) out.stdout("No elegiste nada; no se cambió nada.\n");
    return 0;
  }
  const progress = progressFor(out, options.verbose);
  const failed: string[] = [];
  for (const step of chosen) {
    if (!(await runStep(root, step, progress, out))) failed.push(step.label);
  }
  const next = `Falta: corre '${packageManager(root)} install', revisa el diff y haz commit.`;
  out.stdout(`\n${failed.length === 0 ? "Listo." : `Terminó, pero fallaron: ${failed.join("; ")}.`} ${next}\n`);
  return failed.length === 0 ? 0 : 1;
}
