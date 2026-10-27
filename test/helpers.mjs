// Helpers of the tests: a repo with a main checkout, the fake npx and npm of fake-tools.mjs
// first in PATH, local GitHub repos with release tags (git reaches them through an
// insteadOf rewrite of https://github.com/, so `git ls-remote` is the real one), and the
// compiled CLI.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "dist", "cli.js");
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

// The latest of everything on npm, unless a test says otherwise.
export const NPM = { "@ramon-sg/issue-flow": "0.2.0", "@ramon-sg/claude-cloud": "1.1.0" };

// What the catalogs offer (skills-manager --candidates), unless a test says otherwise.
export const CANDIDATES = [
  { id: "catalog:ramon-sg/issue-flow/github-issues", name: "github-issues", catalog: "ramon-sg/issue-flow", description: "Crea issues cortas", skills: ["github-issues"], requires: [] },
  { id: "catalog:ramon-sg/issue-flow/close-pr", name: "close-pr", catalog: "ramon-sg/issue-flow", description: "Cierra un PR", skills: ["close-pr"], requires: ["pr-review-comments"] },
  { id: "catalog:ramon-sg/issue-flow/pr-review-comments", name: "pr-review-comments", catalog: "ramon-sg/issue-flow", description: "Resuelve comentarios", skills: ["pr-review-comments"], requires: [] },
  { id: "catalog:ramon-sg/agent-skills/planning", name: "planning", catalog: "ramon-sg/agent-skills", description: "Planes cortos", skills: ["planning"], requires: [] },
];

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();

// The npx calls logged in a file, without `--yes`.
const npxCalls = (log) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((call) => call.program === "npx").map((call) => call.args.slice(1)) : []);

// A repo for the tests. `tags` gives the release tags of each GitHub repo.
export function makeRepo({ tags = { "ramon-sg/claude-repo-guard": ["0.1.0", "0.2.0"], "ramon-sg/agent-skills": ["0.1.0", "0.2.0"] } } = {}) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "agent-kitchen-")));
  const main = join(tmp, "main");
  const bin = join(tmp, "bin");
  mkdirSync(main);
  mkdirSync(bin);
  git(main, "init", "-q", "-b", "main");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  for (const [repo, versions] of Object.entries(tags)) {
    const bare = join(tmp, "github", `${repo}.git`);
    mkdirSync(dirname(bare), { recursive: true });
    git(tmp, "init", "-q", "--bare", "-b", "main", bare);
    git(main, "push", "-q", bare, "HEAD:main");
    for (const version of versions) git(main, "push", "-q", bare, `HEAD:refs/tags/v${version}`);
  }
  for (const [name, as] of [["npx", ""], ["npm", "FAKE_AS=npm "]]) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${as}exec node "${join(HERE, "fake-tools.mjs")}" "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const log = join(tmp, "calls.jsonl");
  const env = (extra = {}) => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_LOG: log,
    FAKE_NPM: JSON.stringify(NPM),
    FAKE_CANDIDATES: JSON.stringify(CANDIDATES),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${join(tmp, "github")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    ...extra,
  });
  return {
    tmp,
    main,
    git: (...args) => git(main, ...args),
    // Runs the CLI with no terminal; the log of calls starts empty.
    cli(args, { env: extra = {}, cwd = main } = {}) {
      writeFileSync(log, "");
      const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: env(extra) });
      return { status: result.status, out: result.stdout, err: result.stderr };
    },
    // The npx calls of the last run, without `--yes`, nor the downloads ahead of a step
    // (`--package`) nor the reads of what the catalogs offer (`--candidates`).
    calls: () => npxCalls(log).filter((args) => args[0] !== "--package" && !args.includes("--candidates")),
    // Every npx call of the last run, without `--yes`.
    allCalls: () => npxCalls(log),
    read: (path) => JSON.parse(readFileSync(join(main, path), "utf8")),
    exists: (path) => existsSync(join(main, path)),
    write: (path, value) => {
      mkdirSync(dirname(join(main, path)), { recursive: true });
      writeFileSync(join(main, path), typeof value === "string" ? value : JSON.stringify(value, null, 2));
    },
  };
}

// A repo as agent-kitchen leaves it at the given versions: the flow, its skills and the general
// ones, claude-cloud and claude-repo-guard (with the flow's options).
export function installedRepo({ flow = "0.2.0", cloud = "1.1.0", guard = "0.2.0", general = "v0.2.0", tags } = {}) {
  const repo = makeRepo(tags === undefined ? {} : { tags });
  repo.write("package.json", { devDependencies: { "@ramon-sg/issue-flow": flow, "@ramon-sg/github-rest": "0.2.1", "@ramon-sg/skills-manager": "1.1.0" } });
  repo.write(".agents/flow.json", {});
  const flowSkill = { source: "catalog:ramon-sg/issue-flow", tag: `v${flow}` };
  repo.write(".agents/skills.json", { sources: [{ catalog: "ramon-sg/issue-flow", ref: `v${flow}`, skills: ["close-pr"] }, { catalog: "ramon-sg/agent-skills", skills: ["code-audit"] }] });
  repo.write(".agents/skills.lock.json", { lockVersion: 2, skills: { "close-pr": flowSkill, "pr-review-comments": flowSkill, "code-audit": { source: "catalog:ramon-sg/agent-skills", tag: general }, "test-audit": { source: "catalog:ramon-sg/agent-skills", tag: general } } });
  repo.write(".claude/cloud.json", { version: cloud });
  repo.write(".claude/repo-guard.manifest.json", { version: guard });
  repo.write(".claude/repo-guard.config.json", {
    environment: ["issue-flow is this repo's issue workflow: making the branch and worktree of an issue, its empty start commit, pushing it, opening its draft PR, assigning the issue and adding its \"Slug de rama\" block are normal steps of the work, not risky actions."],
    weakerNetworkIsolation: true,
  });
  return repo;
}
