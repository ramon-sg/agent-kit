#!/usr/bin/env node
/**
 * @file Entry point of `agent-kitchen`: parses the arguments and runs the command. Before
 * that, if npm has a newer agent-kitchen than the one running (npx may run an old copy from
 * its cache), it runs that one instead with the same arguments. Usage errors exit 2 with
 * the usage text; errors of the repo exit 1 with their message.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { doctor } from "./commands/doctor.js";
import { pieceNames, sync } from "./commands/sync.js";
import { KitError, processOutput, UsageError } from "./output.js";
import { FLOW_PACKAGE, GENERAL_CATALOGS } from "./piece.js";
import { PACKAGE as CLOUD_PACKAGE } from "./pieces/cloud.js";
import { REPO as GUARD_REPO } from "./pieces/guard.js";
import { compareVersions, isRelease, latestTag, npmLatest } from "./tools.js";

/** This package on npm. */
const PACKAGE = "agent-kitchen";

/** Set in the run that a newer agent-kitchen was handed to, so it never hands over again. */
const HANDED_OVER = "AGENT_KITCHEN_HANDED_OVER";

/** Usage text. */
const USAGE = `Uso:
  agent-kitchen apply [--yes | --dry-run] [--verbose] [--skip <pieza>,...]
  agent-kitchen doctor

agent-kitchen revisa cada pieza de las herramientas de agentes del repo (${pieceNames().join(", ")}),
muestra qué tiene el repo y la última versión de cada una, y apply ofrece instalar lo que falta
y actualizar lo que está atrasado. En una terminal pregunta una vez: hacer todo lo sugerido,
o elegir los pasos y las skills. --yes hace lo sugerido sin preguntar; sin terminal solo lo
muestra. --verbose muestra la salida de cada herramienta. Córrelo en la copia principal del
repo, desde tu terminal. Sin subcomando hace lo mismo que apply, por ahora.

doctor corre las revisiones de cada pieza en la versión del repo, sin cambiar nada.`;

/**
 * This package's version.
 * @returns The version in its package.json.
 */
function ownVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  return pkg.version ?? "unknown";
}

/**
 * Starts the lookups of the latest versions, so they run while this one checks its own.
 */
function startLookups(): void {
  void npmLatest(FLOW_PACKAGE);
  void npmLatest(CLOUD_PACKAGE);
  void latestTag(GUARD_REPO);
  for (const catalog of GENERAL_CATALOGS) void latestTag(catalog);
}

/**
 * Runs the latest agent-kitchen with the same arguments, if npm has one newer than this.
 * @param argv - The arguments.
 * @returns Its exit code, or null if this one is the latest or npm cannot tell.
 */
async function handOver(argv: string[]): Promise<number | null> {
  const own = ownVersion();
  if (process.env[HANDED_OVER] !== undefined || !isRelease(own)) return null;
  const latest = await npmLatest(PACKAGE);
  if (latest === null || compareVersions(latest, own) <= 0) return null;
  process.stderr.write(`agent-kitchen: uso ${latest}, la última (esta es ${own}).\n`);
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
    options: { yes: { type: "boolean" }, "dry-run": { type: "boolean" }, verbose: { type: "boolean", short: "v" }, skip: { type: "string" }, help: { type: "boolean", short: "h" }, version: { type: "boolean" } },
  });
  if (values.help === true) {
    out.stdout(`${USAGE}\n`);
    return 0;
  }
  if (values.version === true) {
    out.stdout(`${ownVersion()}\n`);
    return 0;
  }
  startLookups();
  const handed = await handOver(argv);
  if (handed !== null) return handed;
  const [command, ...rest] = positionals;
  if (rest.length > 0 || (command !== undefined && command !== "doctor" && command !== "apply")) throw new UsageError(`no existe el comando ${positionals.join(" ")}.`);
  if (command === "doctor") {
    if (values.yes !== undefined || values["dry-run"] !== undefined || values.skip !== undefined || values.verbose !== undefined) throw new UsageError("doctor no lleva opciones.");
    return doctor(process.cwd(), out);
  }
  if (command === undefined) out.stderr("agent-kitchen: usa 'agent-kitchen apply'; sin subcomando dejará de instalar en una versión mayor.\n");
  const skip = (values.skip ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
  return sync({ cwd: process.cwd(), yes: values.yes ?? false, dryRun: values["dry-run"] ?? false, verbose: values.verbose ?? false, skip }, out);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError || (error instanceof TypeError && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS"))) {
    process.stderr.write(`agent-kitchen: ${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else if (error instanceof KitError) {
    process.stderr.write(`agent-kitchen: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
