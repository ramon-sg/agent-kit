// Tests of `agent-kitchen doctor`: it asks each tool's own doctor at the repo's version, adds
// what joins the pieces (the flow's skills at its tag, the guard's option on macOS), and
// only notes what is missing or behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installedRepo, makeRepo } from "./helpers.mjs";

test("doctor passes on a repo with every piece, asking each tool at the repo's version", () => {
  const repo = installedRepo();

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /✗/);
  assert.match(r.out, /✓ issue-flow: skills: 2 en v0\.2\.0/);
  assert.deepEqual(repo.calls().map((args) => args.join(" ")).sort(), [
    "@ramon-sg/issue-flow@0.2.0 doctor --json",
    "@ramon-sg/skills-manager@1.1.0 check",
    "github:ramon-sg/claude-repo-guard#v0.2.0 doctor --json",
  ]);
});

test("doctor names each problem, and only notes a newer release", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  const lock = repo.read(".agents/skills.lock.json");
  lock.skills["close-pr"].tag = "v0.1.0";
  repo.write(".agents/skills.lock.json", lock);
  repo.write(".claude/repo-guard.config.json", {});
  const env = {
    FAKE_FLOW_DOCTOR: '[{"name":"WorktreeRemove hook","ok":false,"detail":"not in .claude/settings.json"}]',
    FAKE_GUARD_DOCTOR: '[{"name":"sandbox","ok":false,"detail":"bubblewrap is missing"},{"name":"auto","ok":true}]',
    FAKE_CHECK_FAIL: "1",
  };

  const r = repo.cli(["doctor"], { env });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ issue-flow: WorktreeRemove hook: not in \.claude\/settings\.json/);
  assert.match(r.out, /✗ issue-flow: skills: close-pr en v0\.1\.0; issue-flow está en 0\.2\.0/);
  assert.match(r.out, /✗ skills: el disco, el lock y el manifiesto no coinciden/);
  assert.match(r.out, /· claude-cloud: 1\.0\.0, hay 1\.1\.0/);
  assert.match(r.out, /✗ claude-repo-guard: sandbox: bubblewrap is missing/);
  assert.doesNotMatch(r.out, /claude-repo-guard: auto/);
  assert.equal(/✗ claude-repo-guard: weakerNetworkIsolation/.test(r.out), process.platform === "darwin");
});

test("doctor on an empty repo only notes what is not installed", () => {
  const repo = makeRepo();

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.out);
  assert.equal(r.out.trim().split("\n").filter((line) => line.startsWith("· ")).length, 4);
  assert.deepEqual(repo.calls(), []);
});

test("doctor does not ask a flow that predates doctor --json, and says to update it", () => {
  const repo = installedRepo({ flow: "0.1.0" });

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /· issue-flow: 0\.1\.0 no tiene doctor --json: corre npx agent-kitchen apply para actualizarlo/);
  assert.ok(repo.calls().every((args) => !args[0].startsWith("@ramon-sg/issue-flow")));
});
