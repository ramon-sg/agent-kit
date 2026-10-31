// Tests of the flow's labels: apply offers `issue-flow labels sync` when GitHub lacks some
// of the labels the flow expects, and doctor notes them, both only with a flow that has the
// command (0.2.6 and later).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installedRepo, makeRepo, NPM } from "./helpers.mjs";

const FLOW = "@ramon-sg/issue-flow";

// The npm latest, with the flow at a version.
const npm = (version) => JSON.stringify({ ...NPM, [FLOW]: version });

// What `labels sync --dry-run --json` prints, with these labels missing.
const labels = (...missing) => JSON.stringify({ repo: "acme/app", dryRun: true, labels: [{ name: "bug", status: "ok" }, ...missing.map((name) => ({ name, status: "to-create" })), { name: "P2: important", status: "differs" }] });

// Every piece but the flow, so only its steps run.
const ONLY = ["--skip", "skills-manager,claude-cloud,claude-repo-guard,skills,agents-md"];

// Whether a call is the write of labels sync (not its --dry-run).
const syncs = (repo) => repo.calls().filter((args) => args[1] === "labels" && !args.includes("--dry-run"));

test("with labels missing, apply offers to create them, ticked, and names them", () => {
  const repo = installedRepo({ flow: "0.2.6" });

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: labels("spike", "P1: urgent") } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Crear en GitHub los labels que faltan: spike, P1: urgent/);
  assert.deepEqual(syncs(repo), []);
});

test("--yes runs labels sync at the repo's version", () => {
  const repo = installedRepo({ flow: "0.2.6" });

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: labels("spike") } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ Crear en GitHub los labels que faltan: spike/);
  assert.deepEqual(syncs(repo), [[`${FLOW}@0.2.6`, "labels", "sync"]]);
});

test("with every label there, or only some that differ, there is no step", () => {
  const repo = installedRepo({ flow: "0.2.6" });

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: labels() } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /labels/);
});

test("when the sync fails, its step fails with how to retry, and the others still run", () => {
  const repo = installedRepo({ flow: "0.2.6", cloud: "1.0.0" });

  const r = repo.cli(["--yes", "--skip", "skills-manager,claude-repo-guard,skills,agents-md"], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: labels("spike"), FAKE_LABELS_FAIL: "1" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ Crear en GitHub los labels que faltan: spike/);
  assert.match(r.err, /issue-flow labels falló; corre 'npx @ramon-sg\/issue-flow@0\.2\.6 labels sync'/);
  assert.match(r.err, /gh auth login is needed/);
  assert.match(r.out, /✓ Actualizar claude-cloud/);
});

test("when the labels cannot be read, there is no step, and the state says so", () => {
  const repo = installedRepo({ flow: "0.2.6" });

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: "not json" } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +0\.2\.6, al día \(no se pudieron leer los labels de GitHub\)/);
  assert.doesNotMatch(r.out, /Crear en GitHub/);
});

test("a flow before labels sync gets no step and is not asked", () => {
  const repo = installedRepo({ flow: "0.2.5" });

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.2.5"), FAKE_LABELS: labels("spike") } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /labels/);
  assert.deepEqual(repo.allCalls().filter((args) => args[1] === "labels"), []);
});

test("updating the flow to a version with labels sync reads the labels with it and syncs after the upgrade", () => {
  const repo = installedRepo({ flow: "0.2.5" });

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: labels("spike") } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.allCalls().filter((args) => args[1] === "labels" && args.includes("--dry-run")).map((args) => args[0]), [`${FLOW}@0.2.6`]);
  assert.deepEqual(repo.calls().filter((args) => args[0].startsWith(FLOW) && !args.includes("--dry-run")).map((args) => args[1]), ["upgrade", "labels"]);
});

test("installing the flow offers the labels too, read with the version it installs", () => {
  const repo = makeRepo();

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: labels("spike") } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Instalar issue-flow 0\.2\.6[^\n]*\n\s+\[x\] Crear en GitHub los labels que faltan: spike/);
});

test("doctor notes the missing labels with ·, and writes nothing", () => {
  const repo = installedRepo({ flow: "0.2.6" });

  const missing = repo.cli(["doctor"], { env: { FAKE_LABELS: labels("spike", "P4: low") } });
  assert.equal(missing.status, 0, missing.out);
  assert.match(missing.out, /· issue-flow: labels: faltan spike, P4: low en GitHub; corre npx agent-kitchen apply/);
  assert.deepEqual(syncs(repo), []);

  const all = repo.cli(["doctor"], { env: { FAKE_LABELS: labels() } });
  assert.match(all.out, /✓ issue-flow: labels: GitHub tiene los que espera el flujo/);
});

test("the labels are not created when the flow's install fails or is not there", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_LABELS: labels("spike"), FAKE_FAIL: "issue-flow@0.2.6 init" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /no se crearon: el repo no tiene issue-flow 0\.2\.6/);
  assert.deepEqual(syncs(repo), []);
});

test("doctor says nothing of labels before 0.2.6, and notes when GitHub cannot be read", () => {
  const old = installedRepo({ flow: "0.2.5" });
  const before = old.cli(["doctor"], { env: { FAKE_LABELS: labels("spike") } });
  assert.doesNotMatch(before.out, /issue-flow: labels/);
  assert.deepEqual(old.allCalls().filter((args) => args[1] === "labels"), []);

  const repo = installedRepo({ flow: "0.2.6" });
  const unread = repo.cli(["doctor"], { env: { FAKE_LABELS: "not json" } });
  assert.equal(unread.status, 0, unread.out);
  assert.match(unread.out, /· issue-flow: labels: no se pudieron leer de GitHub/);
});
