#!/usr/bin/env node
/**
 * @file Entry point of `agent-kit`: parses the arguments and runs the command. Before
 * that, if npm has a newer agent-kit than the one running (npx may run an old copy from
 * its cache), it runs that one instead with the same arguments. Usage errors exit 2 with
 * the usage text; errors of the repo exit 1 with their message.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { doctor } from "./commands/doctor.js";
import { pieceNames, sync } from "./commands/sync.js";
import { KitError, processOutput, UsageError } from "./output.js";
import { compareVersions, isRelease, npmLatest } from "./tools.js";

/** This package on npm. */
const PACKAGE = "agent-kit";

/** Set in the run that a newer agent-kit was handed to, so it never hands over again. */
const HANDED_OVER = "AGENT_KIT_HANDED_OVER";

/** Usage text. */
const USAGE = `Usage:
  agent-kit [--yes | --dry-run] [--skip <piece>,...]
  agent-kit doctor

agent-kit looks at each piece of the repo's agent tooling (${pieceNames().join(", ")}),
shows what the repo has and the latest of each, and offers to install what is missing and
update what is behind: in a terminal, a menu where you untick what you do not want. --yes
runs what it suggests without asking; without a terminal it only shows it. Run it in the
main checkout, from your terminal.

doctor runs each piece's own checks at the repo's version, and changes nothing.`;

/**
 * This package's version.
 * @returns The version in its package.json.
 */
function ownVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  return pkg.version ?? "unknown";
}

/**
 * Runs the latest agent-kit with the same arguments, if npm has one newer than this.
 * @param argv - The arguments.
 * @returns Its exit code, or null if this one is the latest or npm cannot tell.
 */
function handOver(argv: string[]): number | null {
  const own = ownVersion();
  if (process.env[HANDED_OVER] !== undefined || !isRelease(own)) return null;
  const latest = npmLatest(PACKAGE);
  if (latest === null || compareVersions(latest, own) <= 0) return null;
  process.stderr.write(`agent-kit: running ${latest}, the latest (this is ${own}).\n`);
  const result = spawnSync("npx", ["--yes", `${PACKAGE}@${latest}`, ...argv], { stdio: "inherit", env: { ...process.env, [HANDED_OVER]: own } });
  return result.status ?? 1;
}

/**
 * Runs the CLI.
 * @param argv - The arguments, without node and the script.
 * @returns The exit code.
 * @throws UsageError for unknown arguments; KitError from the command.
 */
async function main(argv: string[]): Promise<number> {
  const out = processOutput();
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { yes: { type: "boolean" }, "dry-run": { type: "boolean" }, skip: { type: "string" }, help: { type: "boolean", short: "h" }, version: { type: "boolean" } },
  });
  if (values.help === true) {
    out.stdout(`${USAGE}\n`);
    return 0;
  }
  if (values.version === true) {
    out.stdout(`${ownVersion()}\n`);
    return 0;
  }
  const handed = handOver(argv);
  if (handed !== null) return handed;
  const [command, ...rest] = positionals;
  if (rest.length > 0 || (command !== undefined && command !== "doctor")) throw new UsageError(`unknown command ${positionals.join(" ")}.`);
  if (command === "doctor") {
    if (values.yes !== undefined || values["dry-run"] !== undefined || values.skip !== undefined) throw new UsageError("doctor takes no flags.");
    return doctor(process.cwd(), out);
  }
  const skip = (values.skip ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
  return sync({ cwd: process.cwd(), yes: values.yes ?? false, dryRun: values["dry-run"] ?? false, skip }, out);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError || (error instanceof TypeError && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS"))) {
    process.stderr.write(`agent-kit: ${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else if (error instanceof KitError) {
    process.stderr.write(`agent-kit: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
