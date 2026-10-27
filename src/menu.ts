/**
 * @file The questions, in Spanish (`@clack/prompts`), all asked before any step runs: the
 * quick path (do everything suggested, pick, or leave), the checkbox menu of the steps, the
 * skills of a step grouped by catalog with their description, and whether to replace the
 * repo's own skills. They only run with a terminal.
 */
import { styleText } from "node:util";
import { confirm, groupMultiselect, isCancel, MULTISELECT_INSTRUCTIONS, multiselect, select, SELECT_INSTRUCTIONS } from "@clack/prompts";
import type { Candidate, Step } from "./piece.js";

/** What the person wants after seeing the table. */
export type Path = "all" | "pick" | "leave";

/** Width a skill's description is cut to in the menu. */
const DESCRIPTION_WIDTH = 70;

/**
 * Puts the keys' help of the menus in Spanish. The library exports those lines as arrays,
 * so they are replaced in place.
 */
function spanishKeys(): void {
  MULTISELECT_INSTRUCTIONS.splice(0, MULTISELECT_INSTRUCTIONS.length, `${styleText("dim", "↑/↓")} moverse`, `${styleText("dim", "Espacio:")} marcar`, `${styleText("dim", "Enter:")} seguir`);
  SELECT_INSTRUCTIONS.splice(0, SELECT_INSTRUCTIONS.length, `${styleText("dim", "↑/↓")} moverse`, `${styleText("dim", "Enter:")} elegir`);
}

/**
 * The menu's options: each step's index and label, which names its piece.
 * @param steps - The steps.
 * @returns The options and the ones ticked at the start.
 * @example menuOptions(steps).initialValues // [0, 1]
 */
export function menuOptions(steps: Step[]): { options: { value: number; label: string }[]; initialValues: number[] } {
  return {
    options: steps.map((step, index) => ({ value: index, label: step.label })),
    initialValues: steps.flatMap((step, index) => (step.checked ? [index] : [])),
  };
}

/**
 * The skills menu's options: grouped by catalog, each with its description cut short.
 * @param candidates - What the catalogs offer.
 * @returns The groups.
 * @example Object.keys(skillOptions(candidates)) // ["ramon-sg/issue-flow", "ramon-sg/agent-skills"]
 */
export function skillOptions(candidates: Candidate[]): Record<string, { value: string; label: string; hint?: string }[]> {
  const groups: Record<string, { value: string; label: string; hint?: string }[]> = {};
  for (const candidate of candidates) {
    const hint = candidate.description.length > DESCRIPTION_WIDTH ? `${candidate.description.slice(0, DESCRIPTION_WIDTH - 1)}…` : candidate.description;
    const group = candidate.catalog === "" ? "skills" : candidate.catalog;
    groups[group] = [...(groups[group] ?? []), { value: candidate.id, label: candidate.name, ...(hint === "" ? {} : { hint }) }];
  }
  return groups;
}

/**
 * Asks what to do: everything suggested, pick step by step, or leave.
 * @param count - How many steps are suggested; with none, the option to do them is not shown.
 * @returns The answer; "leave" if the person cancelled.
 * @example await askPath(4) // "all"
 */
export async function askPath(count: number): Promise<Path> {
  spanishKeys();
  const all = { value: "all" as const, label: `Todo lo sugerido (${count} ${count === 1 ? "paso" : "pasos"})`, hint: "recomendado" };
  const answer = await select<Path>({
    message: "¿Qué hago?",
    options: [...(count === 0 ? [] : [all]), { value: "pick", label: "Elegir qué hacer" }, { value: "leave", label: "Salir sin cambiar nada" }],
  });
  return isCancel(answer) ? "leave" : answer;
}

/**
 * Asks which steps to run.
 * @param steps - The steps.
 * @returns The picked ones, in their order, or null if the person cancelled.
 * @example await askSteps(steps)
 */
export async function askSteps(steps: Step[]): Promise<Step[] | null> {
  spanishKeys();
  const { options, initialValues } = menuOptions(steps);
  const picked = await multiselect({ message: "¿Qué pasos hago?", options, initialValues, required: false });
  if (isCancel(picked)) return null;
  return steps.filter((_, index) => picked.includes(index));
}

/**
 * Asks which skills to install.
 * @param candidates - What the catalogs offer.
 * @param ticked - The ids ticked at the start.
 * @returns The picked ids, or null if the person cancelled.
 * @example await askSkills(candidates, ["catalog:ramon-sg/agent-skills/planning"])
 */
export async function askSkills(candidates: Candidate[], ticked: string[]): Promise<string[] | null> {
  spanishKeys();
  const picked = await groupMultiselect({ message: "¿Qué skills instalo?", options: skillOptions(candidates), initialValues: ticked, required: false });
  return isCancel(picked) ? null : picked;
}

/**
 * Asks whether the catalog's skills replace the repo's own ones with the same name.
 * @param own - Their names.
 * @returns True to replace them, false to keep them, or null if the person cancelled.
 * @example await askReplace(["planning"])
 */
export async function askReplace(own: string[]): Promise<boolean | null> {
  const answer = await confirm({
    message: `El repo ya tiene su propia versión de: ${own.join(", ")}. ¿Las reemplazo por las del catálogo? Su project.md se conserva.`,
    active: "Sí, reemplazar",
    inactive: "No, dejarlas fuera",
  });
  return isCancel(answer) ? null : answer;
}
