/**
 * @file What agent-kit knows of each piece it manages, and the names they share. A piece
 * (the issue flow, claude-cloud, claude-repo-guard, the skills) tells what the repo has and
 * the steps that would install or update it; agent-kit shows them, lets the person pick,
 * and runs the picked ones in order. Every step runs the piece's own tool, which owns its
 * files: agent-kit only writes the few lines that join two pieces.
 */
import type { Output } from "./output.js";

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

/** One step a piece offers: what it does, and how it runs. */
export interface Step {
  piece: string;
  label: string;
  checked: boolean;
  run: (context: Context) => boolean;
}

/** What a piece found in the repo. */
export interface PieceStatus {
  name: string;
  summary: string;
  state: string;
  steps: Step[];
}

/** What a step gets when it runs. */
export interface Context {
  root: string;
  yes: boolean;
  out: Output;
}

/** One check of `agent-kit doctor`: passed, failed, or only worth knowing. */
export interface Check {
  name: string;
  status: "ok" | "fail" | "info";
  detail: string;
}
