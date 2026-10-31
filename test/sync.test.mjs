// Tests of the main command, `agent-kitchen`, on real checkouts: what it shows and offers for
// each piece, the order it runs the steps in with --yes, what it writes itself (the guard's
// options, the version of claude-cloud, the flow catalog's tag) and what it leaves to each
// tool, through the fakes of fake-tools.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { CANDIDATES, installedRepo, makeRepo } from "./helpers.mjs";

const ALL_SKILLS = CANDIDATES.map((candidate) => candidate.id).join(",");

test("--dry-run on an empty repo shows the four pieces and the steps that install them, and changes nothing", () => {
  const repo = makeRepo();

  const r = repo.cli(["--dry-run"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +no instalado/);
  assert.match(r.out, /claude-repo-guard +no instalado/);
  assert.match(r.out, /\[x\] Instalar issue-flow 0\.2\.0: /);
  assert.match(r.out, /\[x\] Instalar claude-cloud 1\.1\.0: /);
  assert.match(r.out, /\[x\] Instalar claude-repo-guard 0\.2\.0: /);
  assert.match(r.out, /\[x\] Instalar 4 skills de ramon-sg\/issue-flow y ramon-sg\/agent-skills/);
  assert.deepEqual(repo.calls(), []);
  assert.equal(repo.exists("package.json"), false);
});

test("--yes on an empty repo installs everything in order, each piece with its own tool, every skill offered at the flow's tag", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [
    ["@ramon-sg/issue-flow@0.2.0", "init", "--yes"],
    ["@ramon-sg/claude-cloud@1.1.0", "init"],
    ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"],
    ["@ramon-sg/skills-manager@1.2.0", "init", "--catalog", "ramon-sg/issue-flow#v0.2.0", "--catalog", "ramon-sg/agent-skills", "--select", ALL_SKILLS],
  ]);
  const guard = repo.read(".claude/repo-guard.config.json");
  assert.match(guard.environment[0], /draft PR/);
  assert.equal(guard.weakerNetworkIsolation, process.platform === "darwin" ? true : undefined);
  assert.match(r.out, /✓ Instalar issue-flow 0\.2\.0/);
  assert.match(r.out, /Listo\. Falta: corre 'npm install'/);
});

test("the tools' output is hidden unless a step fails, and shown with --verbose", () => {
  const quiet = makeRepo();
  const loud = makeRepo();

  const r = quiet.cli(["--yes", "--skip", "claude-cloud,claude-repo-guard,skills"], { env: { FAKE_SAY: "salida de la herramienta" } });
  const v = loud.cli(["--yes", "--verbose", "--skip", "claude-cloud,claude-repo-guard,skills"], { env: { FAKE_SAY: "salida de la herramienta" } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(`${r.out}${r.err}`, /salida de la herramienta/);
  assert.equal(v.status, 0, v.err);
  assert.match(`${v.out}${v.err}`, /salida de la herramienta/);
});

test("the repo's own skills are left out with --yes, and the rest are installed", () => {
  const repo = makeRepo();
  repo.write(".agents/skills/planning/SKILL.md", "propia");

  const r = repo.cli(["--yes", "--skip", "claude-cloud,claude-repo-guard"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Se dejan fuera las skills que el repo ya tiene como propias: planning/);
  const select = repo.calls().at(-1);
  assert.equal(select[select.indexOf("--select") + 1], CANDIDATES.filter((candidate) => candidate.name !== "planning").map((candidate) => candidate.id).join(","));
  assert.ok(!select.includes("--replace"));
});

test("without a terminal nor --yes it only shows the steps", () => {
  const repo = makeRepo();

  const r = repo.cli(["apply"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /corre agent-kitchen apply en una terminal, o con --yes/);
  assert.deepEqual(repo.calls(), []);
});

test("a repo at the latest of everything has nothing to do, and asks skills-manager for skills it does not take", () => {
  const repo = installedRepo();
  const taken = JSON.stringify(CANDIDATES.filter((candidate) => ["close-pr", "pr-review-comments"].includes(candidate.name)));

  const r = repo.cli(["--yes"], { env: { FAKE_CANDIDATES: taken } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Todo al día: no hay nada que instalar ni actualizar/);
  assert.deepEqual(repo.allCalls(), [["@ramon-sg/skills-manager@1.2.0", "add", "--candidates", "--catalog", "ramon-sg/issue-flow#v0.2.0", "--catalog", "ramon-sg/agent-skills"]]);
});

test("--yes updates each piece behind: the flow and its skills, claude-cloud's pin, the guard, the general skills", () => {
  const repo = installedRepo({ flow: "0.1.0", cloud: "1.0.0", guard: "0.1.0", general: "v0.1.0" });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [
    ["@ramon-sg/issue-flow@0.2.0", "upgrade"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "close-pr"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "pr-review-comments"],
    ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "code-audit"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "test-audit"],
  ]);
  assert.deepEqual(Object.values(repo.read(".agents/skills.lock.json").skills).map((skill) => skill.tag), ["v0.2.0", "v0.2.0", "v0.2.0", "v0.2.0"]);
  assert.equal(repo.cli(["doctor"]).status, 0);
  assert.equal(repo.read(".claude/cloud.json").version, "1.1.0");
  assert.deepEqual(repo.read(".agents/skills.json").sources.map((source) => source.ref), ["v0.2.0", undefined]);
  assert.match(r.out, /issue-flow +0\.1\.0, hay 0\.2\.0/);
  assert.match(r.out, /Actualizar skills de ramon-sg\/agent-skills v0\.1\.0 → v0\.2\.0: code-audit, test-audit/);
});

test("when only the flow's skills are off the CLI's tag, it moves them alone", () => {
  const repo = installedRepo();
  const lock = repo.read(".agents/skills.lock.json");
  lock.skills["close-pr"].tag = "v0.1.0";
  repo.write(".agents/skills.lock.json", lock);

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Poner las skills del flujo en v0\.2\.0/);
  assert.deepEqual(repo.calls().slice(-2), [["@ramon-sg/skills-manager@1.2.0", "update", "close-pr"], ["@ramon-sg/skills-manager@1.2.0", "update", "pr-review-comments"]]);
});

test("new skills in a catalog are offered unticked, and --yes leaves them", () => {
  const repo = installedRepo();

  const dry = repo.cli(["--dry-run"]);
  const yes = repo.cli(["--yes"]);

  assert.match(dry.out, /\[ \] Agregar skills nuevas \(2\): github-issues, planning/);
  assert.equal(yes.status, 0, yes.err);
  assert.match(yes.out, /Opcional, para elegir en una terminal: Agregar skills nuevas/);
  assert.equal(repo.calls().filter((args) => args[1] === "add").length, 0);
});

test("a guard at the latest without the flow's options gets them, at its own version", () => {
  const repo = installedRepo();
  repo.write(".claude/repo-guard.config.json", { weakerNetworkIsolation: true, allowedDomains: ["example.com"] });
  repo.write(".agents/flow.json", { baseBranch: "staging" });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Ajustar claude-repo-guard a lo que necesita el flujo de issues/);
  assert.match(r.out, /· rama de integración staging/);
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
  assert.match(r.err, /claude-cloud init falló; corre 'npx @ramon-sg\/claude-cloud@1\.1\.0 init'/);
  assert.match(r.err, /fake: claude-cloud failed/);
  assert.match(r.out, /✗ Instalar claude-cloud/);
  assert.deepEqual(repo.calls().map((args) => args[0]), ["@ramon-sg/issue-flow@0.2.0", "@ramon-sg/claude-cloud@1.1.0", "github:ramon-sg/claude-repo-guard#v0.2.0", "@ramon-sg/skills-manager@1.2.0"]);
  assert.match(r.out, /fallaron: Instalar claude-cloud/);
});

test("when issue-flow did not install, the skills step leaves the flow's skills out instead of failing", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "claude-cloud,claude-repo-guard"], { env: { FAKE_FAIL: "issue-flow@0.2.0 init" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /sin las skills del flujo, porque issue-flow no está instalado/);
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1", "init", "--catalog", "ramon-sg/agent-skills", "--select", "catalog:ramon-sg/agent-skills/planning"]);
});

test("--skip leaves pieces out; an unknown piece is a usage error", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "claude-cloud,skills"]);
  const unknown = repo.cli(["--yes", "--skip", "docker"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls().length, 0);
  assert.doesNotMatch(r.out, /claude-cloud/);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /no existe la pieza docker; son skills-manager, issue-flow, claude-cloud, claude-repo-guard, skills/);
});

test("when npm and GitHub cannot tell the latest, a piece is shown and not updated", () => {
  const repo = installedRepo({ flow: "0.1.0", tags: {} });

  const r = repo.cli(["--yes"], { env: { FAKE_NPM: "{}" } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +0\.1\.0, al día \(npm no responde\)/);
  assert.match(r.out, /claude-repo-guard +0\.2\.0, al día \(GitHub no tiene una versión\)/);
  assert.doesNotMatch(r.out, /✓/);
});

test("it refuses to run in a worktree", () => {
  const repo = makeRepo();
  const dir = join(repo.tmp, "wt");
  repo.git("worktree", "add", "-q", "-b", "other", dir);

  const r = repo.cli(["--yes"], { cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /corre agent-kitchen apply en la copia principal/);
  assert.deepEqual(repo.calls(), []);
});

test("without the issue flow, the guard is not told about it and the skills come from the general catalogs only", () => {
  const repo = makeRepo();

  const general = JSON.stringify(CANDIDATES.filter((candidate) => candidate.catalog === "ramon-sg/agent-skills"));

  const r = repo.cli(["--yes", "--skip", "issue-flow"], { env: { FAKE_CANDIDATES: general } });

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.allCalls().some((args) => args.includes("--candidates") && !args.includes("ramon-sg/issue-flow#v0.2.0")));
  assert.equal(repo.exists(".claude/repo-guard.config.json") ? repo.read(".claude/repo-guard.config.json").environment : undefined, undefined);
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1", "init", "--catalog", "ramon-sg/agent-skills", "--select", "catalog:ramon-sg/agent-skills/planning"]);
});

test("the latest tag is the highest version, not the last one as text", () => {
  const repo = installedRepo({ guard: "0.9.0", tags: { "ramon-sg/claude-repo-guard": ["0.9.0", "0.10.0"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--dry-run"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Actualizar claude-repo-guard 0\.9\.0 → 0\.10\.0/);
});

test("when the flow is installed in this run, a guard already at the latest gets the flow's options too", () => {
  const repo = makeRepo();
  repo.write(".claude/repo-guard.manifest.json", { version: "0.2.0" });
  repo.write(".claude/repo-guard.config.json", { weakerNetworkIsolation: true });

  const r = repo.cli(["--yes", "--skip", "claude-cloud,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.match(repo.read(".claude/repo-guard.config.json").environment[0], /issue-flow is this repo's issue workflow/);
  assert.deepEqual(repo.calls(), [["@ramon-sg/issue-flow@0.2.0", "init", "--yes"], ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"]]);
});

test("on macOS a weakerNetworkIsolation the guard left false is offered as true", { skip: process.platform !== "darwin" }, () => {
  const repo = installedRepo();
  repo.write(".claude/repo-guard.config.json", { ...repo.read(".claude/repo-guard.config.json"), weakerNetworkIsolation: false });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.read(".claude/repo-guard.config.json").weakerNetworkIsolation, true);
});

test("a flow version that is not an exact release is shown and left alone", () => {
  const repo = installedRepo();
  repo.write("package.json", { devDependencies: { "@ramon-sg/issue-flow": "file:../issue-flow", "@ramon-sg/skills-manager": "1.2.0" } });

  const r = repo.cli(["--dry-run", "--skip", "skills"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +package\.json tiene file:\.\.\/issue-flow, no una versión exacta/);
  assert.doesNotMatch(r.out, /\[x\] .*issue-flow/);
});

test("updating claude-cloud moves a $schema pinned to its version as well", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  repo.write(".claude/cloud.json", { $schema: "https://unpkg.com/@ramon-sg/claude-cloud@1.0.0/schema.json", version: "1.0.0", apt: ["jq"] });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.read(".claude/cloud.json"), { $schema: "https://unpkg.com/@ramon-sg/claude-cloud@1.1.0/schema.json", version: "1.1.0", apt: ["jq"] });
});

test("a general catalog that follows a branch is not offered as behind, and skills already in the lock are not new", () => {
  const repo = installedRepo({ general: "v0.1.0" });
  const manifest = repo.read(".agents/skills.json");
  manifest.sources[1].ref = "main";
  repo.write(".agents/skills.json", manifest);

  const offered = JSON.stringify(CANDIDATES.filter((candidate) => ["pr-review-comments", "planning"].includes(candidate.name)));

  const r = repo.cli(["--dry-run"], { env: { FAKE_CANDIDATES: offered } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /Actualizar skills de ramon-sg\/agent-skills/);
  assert.match(r.out, /\[ \] Agregar skills nuevas \(1\): planning/);
});

test("the skills lock is where the manifest's paths.lock says", () => {
  const repo = installedRepo({ general: "v0.1.0" });
  const lock = repo.read(".agents/skills.lock.json");
  repo.write("tools/skills.lock.json", lock);
  repo.write(".agents/skills.lock.json", { lockVersion: 2, skills: {} });
  repo.write(".agents/skills.json", { ...repo.read(".agents/skills.json"), paths: { lock: "tools/skills.lock.json" } });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls().filter((args) => args[1] === "update").map((args) => args[2]), ["code-audit", "test-audit"]);
  assert.equal(repo.read("tools/skills.lock.json").skills["code-audit"].tag, "v0.2.0");
});

test("when npm has a newer agent-kitchen it runs that one with the same arguments, and that one does not hand over again", () => {
  const repo = makeRepo();
  const npm = JSON.stringify({ "agent-kitchen": "9.0.0", "@ramon-sg/issue-flow": "0.2.0", "@ramon-sg/claude-cloud": "1.1.0" });

  const handed = repo.cli(["--dry-run", "--skip", "skills"], { env: { FAKE_NPM: npm } });
  const calls = repo.calls();
  const again = repo.cli(["--dry-run"], { env: { FAKE_NPM: npm, AGENT_KITCHEN_HANDED_OVER: "0.1.0" } });

  assert.equal(handed.status, 0, handed.err);
  assert.match(handed.err, /uso 9\.0\.0, la última/);
  assert.deepEqual(calls, [["agent-kitchen@9.0.0", "--dry-run", "--skip", "skills"]]);
  assert.doesNotMatch(handed.out, /Este repo tiene/);
  assert.equal(again.status, 0, again.err);
  assert.match(again.out, /Este repo tiene/);
});

test("the guard updates with apply from 0.5.0 on, as the issue's repro: 0.5.0 → 0.5.1", () => {
  const repo = installedRepo({ guard: "0.5.0", tags: { "ramon-sg/claude-repo-guard": ["0.5.0", "0.5.1"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--yes", "--skip", "issue-flow,claude-cloud,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Actualizar claude-repo-guard 0\.5\.0 → 0\.5\.1/);
  assert.ok(repo.calls().some((args) => args.join(" ") === "github:ramon-sg/claude-repo-guard#v0.5.1 apply --yes"));
  assert.equal(repo.read(".claude/repo-guard.manifest.json").version, "0.5.1");
});

test("a guard before 0.5.0 still gets its options with install, at its own version", () => {
  const repo = installedRepo({ guard: "0.4.1", tags: { "ramon-sg/claude-repo-guard": ["0.4.1"], "ramon-sg/agent-skills": ["0.2.0"] } });
  repo.write(".claude/repo-guard.config.json", {});

  const r = repo.cli(["--yes", "--skip", "issue-flow,claude-cloud,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.calls().some((args) => args.join(" ") === "github:ramon-sg/claude-repo-guard#v0.4.1 install --yes"));
});

test("when the guard fails, its own error is shown, without the sandbox hint", () => {
  const repo = installedRepo({ guard: "0.5.0", tags: { "ramon-sg/claude-repo-guard": ["0.5.0", "0.5.1"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--yes", "--skip", "issue-flow,claude-cloud,skills"], { env: { FAKE_GUARD_ERROR: "claude-repo-guard: .claude/settings.json no es JSON válido" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /claude-repo-guard no se instaló; su error está abajo\. Para reintentar a mano: 'npx github:ramon-sg\/claude-repo-guard#v0\.5\.1 apply'/);
  assert.match(r.err, /settings\.json no es JSON válido/);
  assert.doesNotMatch(r.err, /sandbox/);
});

test("when the guard cannot write, the hint about Claude's sandbox is added to its error", () => {
  const repo = installedRepo({ guard: "0.5.0", tags: { "ramon-sg/claude-repo-guard": ["0.5.0", "0.5.1"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--yes", "--skip", "issue-flow,claude-cloud,skills"], { env: { FAKE_GUARD_ERROR: "claude-repo-guard: EPERM: operation not permitted, open '.claude/settings.json'" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /no tuvo permiso para escribir en el repo\. Si corres agent-kitchen dentro de una sesión de Claude, su sandbox bloquea \.claude\/settings\.json; corre 'npx github:ramon-sg\/claude-repo-guard#v0\.5\.1 apply' desde tu terminal/);
  assert.match(r.err, /EPERM: operation not permitted/);
});
