/**
 * @file What agent-kitchen knows of each piece it manages, and the names they share. A piece
 * (the version of skills-manager, the issue flow, claude-cloud, claude-repo-guard, the
 * skills, the rule in AGENTS.md) tells what the repo has and the steps that would install or
 * update it; agent-kitchen shows them, lets the person pick, and runs the picked ones in
 * order. Every step runs the piece's own tool, which owns its files: agent-kitchen only
 * writes the few lines that join two pieces, the one line of AGENTS.md, which has no tool,
 * and the version of skills-manager in package.json, which agent-kitchen is the one to run.
 */

/** The issue flow on npm. */
export const FLOW_PACKAGE = "@ramon-sg/issue-flow";

/** The GitHub repo of the issue flow, which is also the catalog of its skills. */
export const FLOW_CATALOG = "ramon-sg/issue-flow";

/** The catalogs of general skills, offered next to the flow's. */
export const GENERAL_CATALOGS = ["ramon-sg/agent-skills"];

/** `skills-manager` when the repo does not pin it. */
export const SKILLS_MANAGER = "@ramon-sg/skills-manager";

/** Where `skills-manager` keeps the repo's skills manifest. */
export const SKILLS_MANIFEST = ".agents/skills.json";

/** Where `skills-manager` keeps the repo's skills lock. */
export const SKILLS_LOCK = ".agents/skills.lock.json";

/** The issue flow's config. */
export const FLOW_CONFIG = ".agents/flow.json";

/** A skill a catalog offers, as `skills-manager --candidates` lists it. */
export interface Candidate {
  id: string;
  name: string;
  catalog: string;
  description: string;
  skills: string[];
  requires: string[];
}

/** The skills a step installs: what it offers, and what the person picked and lets it replace. */
export interface SkillPick {
  candidates: Candidate[];
  picked: string[];
  replace: string[];
}

/** One step a piece offers: what it does, what it downloads, and how it runs. */
export interface Step {
  piece: string;
  label: string;
  checked: boolean;
  downloads: string[];
  skills?: SkillPick;
  run: (context: Context) => Promise<boolean>;
}

/** What a piece found in the repo: whether it has it, how it is, and the steps offered. */
export interface PieceStatus {
  name: string;
  summary: string;
  installed: boolean;
  state: string;
  steps: Step[];
}

/**
 * What a step gets when it runs: the repo, and where to say what it did (`note`, one short
 * line under the step) or what went wrong (`fail`, with the command to run by hand and the
 * tool's output).
 */
export interface Context {
  root: string;
  note: (text: string) => void;
  fail: (text: string, output?: string) => void;
}

/** One check of `agent-kitchen doctor`: passed, failed, or only worth knowing. */
export interface Check {
  name: string;
  status: "ok" | "fail" | "info";
  detail: string;
}
