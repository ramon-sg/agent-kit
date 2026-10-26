// Tests of the main command, `agent-kit`, on real checkouts: what it shows and offers for
// each piece, the order it runs the steps in with --yes, what it writes itself (the guard's
// options, the version of claude-cloud, the flow catalog's tag) and what it leaves to each
// tool, through the fakes of fake-tools.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { installedRepo, makeRepo } from "./helpers.mjs";

const DEFAULT_SKILLS = "catalog:ramon-sg/issue-flow/github-issues,catalog:ramon-sg/issue-flow/start-issue,catalog:ramon-sg/issue-flow/close-pr,catalog:ramon-sg/issue-flow/pr-review-comments,catalog:ramon-sg/issue-flow/pr-worktree,catalog:ramon-sg/agent-skills/code-audit";

test("--dry-run on an empty repo shows the four pieces and the steps that install them, and changes nothing", () => {
  const repo = makeRepo();

  const r = repo.cli(["--dry-run"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +not installed/);
  assert.match(r.out, /claude-repo-guard +not installed/);
  assert.match(r.out, /\[x\] issue-flow 0\.2\.0: /);
  assert.match(r.out, /\[x\] claude-cloud 1\.1\.0: /);
  assert.match(r.out, /\[x\] claude-repo-guard 0\.2\.0: /);
  assert.match(r.out, /\[x\] skills: pick them from ramon-sg\/issue-flow and ramon-sg\/agent-skills/);
  assert.deepEqual(repo.calls(), []);
  assert.equal(repo.exists("package.json"), false);
});

test("--yes on an empty repo installs everything in order, each piece with its own tool, the skills at the flow's tag", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [
    ["@ramon-sg/issue-flow@0.2.0", "init", "--yes"],
    ["@ramon-sg/claude-cloud@1.1.0", "init"],
    ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"],
    ["@ramon-sg/skills-manager@1.1.0", "init", "--catalog", "ramon-sg/issue-flow#v0.2.0", "--catalog", "ramon-sg/agent-skills", "--select", DEFAULT_SKILLS],
  ]);
  const guard = repo.read(".claude/repo-guard.config.json");
  assert.match(guard.environment[0], /draft PR/);
  assert.equal(guard.weakerNetworkIsolation, process.platform === "darwin" ? true : undefined);
  assert.match(r.out, /Done\. Next: run 'npm install'/);
});

test("without a terminal nor --yes it only shows the steps", () => {
  const repo = makeRepo();

  const r = repo.cli([]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /run it in a terminal to pick, or with --yes/);
  assert.deepEqual(repo.calls(), []);
});

test("a repo at the latest of everything has nothing to do, and asks skills-manager for skills it does not take", () => {
  const repo = installedRepo();

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Nothing to install or update/);
  assert.deepEqual(repo.calls(), [["@ramon-sg/skills-manager@1.1.0", "add", "--candidates", "--catalog", "ramon-sg/issue-flow#v0.2.0", "--catalog", "ramon-sg/agent-skills"]]);
});

test("--yes updates each piece behind: the flow and its skills, claude-cloud's pin, the guard, the general skills", () => {
  const repo = installedRepo({ flow: "0.1.0", cloud: "1.0.0", guard: "0.1.0", general: "v0.1.0" });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls().filter((args) => !args.includes("--candidates")), [
    ["@ramon-sg/issue-flow@0.2.0", "upgrade"],
    ["@ramon-sg/skills-manager@1.1.0", "update", "close-pr", "pr-review-comments"],
    ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"],
    ["@ramon-sg/skills-manager@1.1.0", "update", "code-audit", "test-audit"],
  ]);
  assert.equal(repo.read(".claude/cloud.json").version, "1.1.0");
  assert.deepEqual(repo.read(".agents/skills.json").sources.map((source) => source.ref), ["v0.2.0", undefined]);
  assert.match(r.out, /issue-flow +0\.1\.0, 0\.2\.0 available/);
  assert.match(r.out, /ramon-sg\/agent-skills: code-audit, test-audit v0\.1\.0 → v0\.2\.0/);
});

test("when only the flow's skills are off the CLI's tag, it moves them alone", () => {
  const repo = installedRepo();
  const lock = repo.read(".agents/skills.lock.json");
  lock.skills["close-pr"].tag = "v0.1.0";
  repo.write(".agents/skills.lock.json", lock);

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow's skills → v0\.2\.0/);
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1.1.0", "update", "close-pr", "pr-review-comments"]);
});

test("new skills in a catalog are offered unticked, and --yes leaves them", () => {
  const repo = installedRepo();
  const candidates = JSON.stringify([{ name: "planning" }, { name: "narrative-summary" }]);

  const dry = repo.cli(["--dry-run"], { env: { FAKE_CANDIDATES: candidates } });
  const yes = repo.cli(["--yes"], { env: { FAKE_CANDIDATES: candidates } });

  assert.match(dry.out, /\[ \] skills: 2 more to pick \(planning, narrative-summary\)/);
  assert.equal(yes.status, 0, yes.err);
  assert.equal(repo.calls().filter((args) => args[1] === "add" && !args.includes("--candidates")).length, 0);
});

test("a guard at the latest without the flow's options gets them, at its own version", () => {
  const repo = installedRepo();
  repo.write(".claude/repo-guard.config.json", { weakerNetworkIsolation: true, allowedDomains: ["example.com"] });
  repo.write(".agents/flow.json", { baseBranch: "staging" });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /claude-repo-guard: what the issue flow needs in its options/);
  const guard = repo.read(".claude/repo-guard.config.json");
  assert.deepEqual(guard.allowedDomains, ["example.com"]);
  assert.equal(guard.integrationBranch, "staging");
  assert.match(guard.environment[0], /issue-flow is this repo's issue workflow/);
  assert.ok(repo.calls().some((args) => args.join(" ") === "github:ramon-sg/claude-repo-guard#v0.2.0 install --yes"));
});

test("a step that fails does not stop the rest, says how to retry, and exits 1", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes"], { env: { FAKE_FAIL: "claude-cloud" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /claude-cloud init failed; run 'npx @ramon-sg\/claude-cloud@1\.1\.0 init'/);
  assert.deepEqual(repo.calls().map((args) => args[0]), ["@ramon-sg/issue-flow@0.2.0", "@ramon-sg/claude-cloud@1.1.0", "github:ramon-sg/claude-repo-guard#v0.2.0", "@ramon-sg/skills-manager@1.1.0"]);
  assert.match(r.out, /these failed: claude-cloud/);
});

test("--skip leaves pieces out; an unknown piece is a usage error", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "claude-cloud,skills"]);
  const unknown = repo.cli(["--yes", "--skip", "docker"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls().length, 0);
  assert.doesNotMatch(r.out, /claude-cloud/);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /unknown piece docker; there are issue-flow, claude-cloud, claude-repo-guard, skills/);
});

test("when npm and GitHub cannot tell the latest, a piece is shown and not updated", () => {
  const repo = installedRepo({ flow: "0.1.0", tags: {} });

  const r = repo.cli(["--yes"], { env: { FAKE_NPM: "{}" } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +0\.1\.0 \(npm cannot tell the latest\)/);
  assert.match(r.out, /claude-repo-guard +0\.2\.0 \(GitHub has no release tag\)/);
  assert.match(r.out, /Nothing to install or update/);
});

test("it refuses to run in a worktree", () => {
  const repo = makeRepo();
  const dir = join(repo.tmp, "wt");
  repo.git("worktree", "add", "-q", "-b", "other", dir);

  const r = repo.cli(["--yes"], { cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /run agent-kit in the main checkout/);
  assert.deepEqual(repo.calls(), []);
});

test("without the issue flow, the guard is not told about it and the skills come from the general catalogs only", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "issue-flow"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.exists(".claude/repo-guard.config.json") ? repo.read(".claude/repo-guard.config.json").environment : undefined, undefined);
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1", "init", "--catalog", "ramon-sg/agent-skills", "--select", "catalog:ramon-sg/agent-skills/code-audit"]);
});

test("the latest tag is the highest version, not the last one as text", () => {
  const repo = installedRepo({ guard: "0.9.0", tags: { "ramon-sg/claude-repo-guard": ["0.9.0", "0.10.0"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--dry-run"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] claude-repo-guard 0\.9\.0 → 0\.10\.0/);
});
