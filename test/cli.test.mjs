// Tests of the command line: `apply` installs and updates the pieces, as the bare command
// did; the bare command still works but says to use `apply`; and every text that tells the
// person what to run says `apply`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installedRepo, makeRepo } from "./helpers.mjs";

const NOTICE = /usa 'agent-kitchen apply'/;

test("apply --dry-run shows what the bare command shows, without the notice", () => {
  const repo = makeRepo();

  const applied = repo.cli(["apply", "--dry-run"]);
  const bare = repo.cli(["--dry-run"]);

  assert.equal(applied.status, 0, applied.err);
  assert.match(applied.out, /\[x\] Instalar issue-flow 0\.2\.0: /);
  assert.equal(applied.out, bare.out);
  assert.doesNotMatch(applied.err, NOTICE);
  assert.match(bare.err, NOTICE);
});

test("apply --yes installs with the same calls as the bare command did", () => {
  const applied = makeRepo();
  const bare = makeRepo();

  const a = applied.cli(["apply", "--yes", "--skip", "claude-repo-guard"]);
  const callsA = applied.calls();
  const b = bare.cli(["--yes", "--skip", "claude-repo-guard"]);

  assert.equal(a.status, 0, a.err);
  assert.equal(b.status, 0, b.err);
  assert.ok(callsA.length > 0);
  assert.deepEqual(callsA.map((args) => args[0]), bare.calls().map((args) => args[0]));
  assert.equal(applied.exists("package.json"), true);
});

test("a newer agent-kitchen gets apply too, and the bare command's notice is left to it", () => {
  const repo = makeRepo();
  const npm = JSON.stringify({ "agent-kitchen": "9.0.0", "@ramon-sg/issue-flow": "0.2.0", "@ramon-sg/claude-cloud": "1.1.0" });

  const applied = repo.cli(["apply", "--dry-run"], { env: { FAKE_NPM: npm } });
  const appliedCalls = repo.calls();
  const bare = repo.cli(["--dry-run"], { env: { FAKE_NPM: npm } });

  assert.equal(applied.status, 0, applied.err);
  assert.deepEqual(appliedCalls, [["agent-kitchen@9.0.0", "apply", "--dry-run"]]);
  assert.deepEqual(repo.calls(), [["agent-kitchen@9.0.0", "--dry-run"]]);
  assert.doesNotMatch(bare.err, NOTICE);
});

test("apply takes no other word, and doctor still takes no options", () => {
  const repo = makeRepo();

  const extra = repo.cli(["apply", "now"]);
  const doctor = repo.cli(["doctor", "--yes"]);

  assert.equal(extra.status, 2);
  assert.match(extra.err, /no existe el comando apply now/);
  assert.equal(doctor.status, 2);
});

test("the usage and doctor's hints say npx agent-kitchen apply", () => {
  const repo = makeRepo();
  repo.write("package.json", { name: "app" });

  const help = repo.cli(["--help"]);
  const doctor = repo.cli(["doctor"]);

  assert.match(help.out, /agent-kitchen apply \[--yes \| --dry-run\]/);
  assert.doesNotMatch(help.err, NOTICE);
  assert.match(doctor.out, /corre npx agent-kitchen apply/);
  assert.doesNotMatch(doctor.out, /corre npx agent-kitchen(?! apply)/);
});

test("every doctor hint of a piece behind says apply", () => {
  const repo = installedRepo({ cloud: "1.0.0", flow: "0.1.0" });

  const r = repo.cli(["doctor"]);

  assert.match(r.out, /hay 1\.1\.0: corre npx agent-kitchen apply/);
  assert.match(r.out, /issue-flow está en 0\.1\.0: corre npx agent-kitchen apply|no tiene doctor --json: corre npx agent-kitchen apply/);
  assert.doesNotMatch(r.out, /corre npx agent-kitchen(?! apply)/);
});
