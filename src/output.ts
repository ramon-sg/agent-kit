/**
 * @file Where commands write, and the errors that end them. Commands get an `Output`
 * instead of writing to `process` directly, so the entry point decides about the terminal.
 */

/** Usage error: exits 2 and prints the usage text. */
export class UsageError extends Error {}

/** An error of the repo or of a file in it: exits 1 with the message. */
export class KitError extends Error {}

/** Where a command writes, and whether someone can answer a question. */
export interface Output {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  interactive: boolean;
}

/**
 * The process's output; interactive when both stdin and stdout are a terminal.
 * @returns The output.
 * @example processOutput().interactive
 */
export function processOutput(): Output {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  };
}

/**
 * Prints a warning on stderr with the program's name.
 * @param out - Where to write.
 * @param text - The warning.
 * @example warn(out, "claude-cloud init failed")
 */
export function warn(out: Output, text: string): void {
  out.stderr(`agent-kitchen: ${text}\n`);
}
