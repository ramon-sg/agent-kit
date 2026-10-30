/**
 * @file The rule in AGENTS.md that makes the agent check the installed version of a library
 * before using it, instead of the one it remembers. It is one fixed line, so AGENTS.md stays
 * small: it loads in every session. This piece has no tool of its own: agent-kitchen writes
 * the line, as it writes the guard's options. Claude Code does not read AGENTS.md when the
 * repo has a CLAUDE.md, so that file gets `@AGENTS.md` too. Only for repos with package.json.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Check, Context, PieceStatus } from "../piece.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "agents-md";

/** The line, as AGENTS.md has it. */
export const VERSION_RULE = "Antes de usar una biblioteca, mira su versión instalada en `node_modules/<biblioteca>/package.json` y lee sus tipos o su documentación ahí. Si no alcanza, busca la documentación de esa versión, no la última.";

/** The line that makes Claude Code read AGENTS.md from CLAUDE.md. */
const IMPORT = "@AGENTS.md";

/**
 * A file's text, or null if it does not exist.
 * @param root - The repo.
 * @param name - The file.
 * @returns Its text, or null.
 */
function readText(root: string, name: string): string | null {
  const path = join(root, name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * Whether a text has a line, exactly.
 * @param text - The text, or null.
 * @param line - The line.
 * @returns Whether it has it.
 */
function hasLine(text: string | null, line: string): boolean {
  return text !== null && text.split("\n").some((each) => each.trim() === line);
}

/**
 * Whether CLAUDE.md and AGENTS.md are one file through a link (`ln -s AGENTS.md CLAUDE.md`):
 * then Claude Code already reads the rule, and an import would make AGENTS.md import itself.
 * @param root - The repo.
 * @returns Whether they are the same file.
 */
function sameFile(root: string): boolean {
  try {
    return realpathSync(join(root, "CLAUDE.md")) === realpathSync(join(root, "AGENTS.md"));
  } catch {
    return false;
  }
}

/**
 * What the repo lacks: the rule in AGENTS.md, and the import in a CLAUDE.md that exists and
 * is not AGENTS.md itself.
 * @param root - The repo.
 * @returns Whether each one is missing.
 */
function missing(root: string): { rule: boolean; import: boolean } {
  const claude = readText(root, "CLAUDE.md");
  return { rule: !hasLine(readText(root, "AGENTS.md"), VERSION_RULE), import: claude !== null && !hasLine(claude, IMPORT) && !sameFile(root) };
}

/**
 * Adds a line at the end of a file, after a blank line, with the file's own line endings, or
 * creates the file with it. Nothing the file had is lost but its trailing blank lines.
 * @param root - The repo.
 * @param name - The file.
 * @param line - The line.
 */
function append(root: string, name: string, line: string): void {
  const text = readText(root, name) ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const kept = text.replace(/(?:\r?\n)+$/, "");
  writeFileSync(join(root, name), `${kept.trim() === "" ? "" : `${kept}${eol}${eol}`}${line}${eol}`);
}

/**
 * Writes what is missing, if the repo has package.json by now.
 * @param context - Where it runs.
 * @returns Always true: a repo without package.json gets nothing, and that is no failure.
 */
function write(context: Context): boolean {
  if (!existsSync(join(context.root, "package.json"))) {
    context.note("sin package.json: no se agregó nada");
    return true;
  }
  const lack = missing(context.root);
  if (lack.rule) append(context.root, "AGENTS.md", VERSION_RULE);
  if (lack.import) append(context.root, "CLAUDE.md", IMPORT);
  return true;
}

/**
 * What the repo has of the rule, and the step that adds it.
 * @param root - The repo.
 * @param flowComing - Whether this run installs the flow, which writes package.json.
 * @returns The piece's status, or null if the repo has no package.json and gets none.
 * @example (await agentsMdStatus(root, false))?.state // "falta la regla"
 */
export async function agentsMdStatus(root: string, flowComing: boolean): Promise<PieceStatus | null> {
  if (!existsSync(join(root, "package.json")) && !flowComing) return null;
  const lack = missing(root);
  const summary = "regla de versiones instaladas en AGENTS.md";
  if (!lack.rule && !lack.import) return { name: NAME, summary, installed: true, state: "al día", steps: [] };
  const files = [...(lack.rule ? ["AGENTS.md"] : []), ...(lack.import ? ["CLAUDE.md"] : [])];
  const label = lack.rule ? `Agregar a AGENTS.md la regla de versiones instaladas${lack.import ? " (y @AGENTS.md en CLAUDE.md)" : ""}` : "Agregar @AGENTS.md a CLAUDE.md, para que Claude Code lea AGENTS.md";
  const state = lack.rule ? "falta la regla" : "CLAUDE.md no importa AGENTS.md";
  return { name: NAME, summary, installed: !lack.rule, state, steps: [{ piece: NAME, checked: true, downloads: [], label: `${label}: ${files.join(", ")}`, run: async (context) => write(context) }] };
}

/**
 * Whether AGENTS.md has the rule and CLAUDE.md, if there is one, imports it. Only noted.
 * @param root - The repo.
 * @returns The checks; none without package.json.
 * @example (await agentsMdChecks(root))[0].status // "ok"
 */
export async function agentsMdChecks(root: string): Promise<Check[]> {
  if (!existsSync(join(root, "package.json"))) return [];
  const lack = missing(root);
  const checks: Check[] = [];
  if (lack.rule) checks.push({ name: NAME, status: "info", detail: "falta la regla de versiones en AGENTS.md; corre npx agent-kitchen apply" });
  if (lack.import) checks.push({ name: NAME, status: "info", detail: "CLAUDE.md no importa AGENTS.md, así que Claude Code no lo lee; corre npx agent-kitchen apply" });
  return checks.length > 0 ? checks : [{ name: NAME, status: "ok", detail: "regla de versiones en AGENTS.md" }];
}
