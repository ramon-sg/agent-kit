/**
 * @file The checkbox menu of the steps (`@clack/prompts`): one line per step, the ones a
 * piece suggests already ticked; space toggles, enter runs (the library shows the keys). It
 * only runs with a terminal.
 */
import { isCancel, multiselect } from "@clack/prompts";
import type { Step } from "./piece.js";

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
 * Asks which steps to run.
 * @param steps - The steps.
 * @returns The picked ones, in their order, or null if the person cancelled.
 * @example await askSteps(steps)
 */
export async function askSteps(steps: Step[]): Promise<Step[] | null> {
  const { options, initialValues } = menuOptions(steps);
  const picked = await multiselect({ message: "What to do?", options, initialValues, required: false });
  if (isCancel(picked)) return null;
  return steps.filter((_, index) => picked.includes(index));
}
