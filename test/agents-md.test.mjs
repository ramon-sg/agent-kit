// Tests of the agents-md piece: the one line agent-kitchen writes itself into AGENTS.md, so
// the agent checks the installed version of a library before using it, and the import
// CLAUDE.md needs for Claude Code to read AGENTS.md at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, RULE } from "./helpers.mjs";

const ONLY = ["--skip", "issue-flow,claude-cloud,claude-repo-guard,skills"];

const text = (repo, path) => readFileSync(join(repo.main, path), "utf8");

test("a repo with package.json and no AGENTS.md is offered the rule, ticked", () => {
  const repo = makeRepo();
  repo.write("package.json", { name: "app" });

  const r = repo.cli(["--dry-run", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Agregar a AGENTS\.md la regla de versiones instaladas/);
  assert.equal(repo.exists("AGENTS.md"), false);
});

test("--yes writes AGENTS.md with only the rule, and creates no CLAUDE.md", () => {
  const repo = makeRepo();
  repo.write("package.json", { name: "app" });

  const r = repo.cli(["--yes", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.equal(text(repo, "AGENTS.md"), `${RULE}\n`);
  assert.equal(repo.exists("CLAUDE.md"), false);
});

test("the repo's own AGENTS.md and CLAUDE.md keep what they have; the rule and the import go at the end", () => {
  const repo = makeRepo();
  repo.write("package.json", { name: "app" });
  repo.write("AGENTS.md", "# App\n\nUsa pnpm.\n");
  repo.write("CLAUDE.md", "Responde en español.\n");

  const r = repo.cli(["--yes", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.equal(text(repo, "AGENTS.md"), `# App\n\nUsa pnpm.\n\n${RULE}\n`);
  assert.equal(text(repo, "CLAUDE.md"), "Responde en español.\n\n@AGENTS.md\n");
  assert.match(r.out, /CLAUDE\.md/);
});

test("in an empty repo the rule comes in the same run that installs the flow", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "claude-cloud,claude-repo-guard,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.exists("package.json"), true);
  assert.equal(text(repo, "AGENTS.md"), `${RULE}\n`);
});

test("--skip agents-md leaves it out, and an unknown piece is still a usage error", () => {
  const repo = makeRepo();
  repo.write("package.json", { name: "app" });

  const r = repo.cli(["--yes", ...ONLY.slice(0, 1), `${ONLY[1]},agents-md`]);
  const unknown = repo.cli(["--yes", "--skip", "docker"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.exists("AGENTS.md"), false);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /no existe la pieza docker; son skills-manager, issue-flow, claude-cloud, claude-repo-guard, skills, agents-md/);
});

test("with the rule and the import there is nothing to do; without package.json the piece is not shown", () => {
  const withRule = makeRepo();
  withRule.write("package.json", { name: "app" });
  withRule.write("AGENTS.md", `${RULE}\n`);
  withRule.write("CLAUDE.md", "Responde en español.\n\n@AGENTS.md\n");
  const bare = makeRepo();

  const done = withRule.cli(["--yes", ...ONLY]);
  const none = bare.cli(["--dry-run", "--skip", "issue-flow,claude-cloud,claude-repo-guard,skills"]);

  assert.equal(done.status, 0, done.err);
  assert.match(done.out, /Todo al día/);
  assert.doesNotMatch(none.out, /agents-md/);
});

test("doctor notes a missing rule or import with ·, never ✗, and passes when both are there", () => {
  const repo = makeRepo();
  repo.write("package.json", { name: "app" });

  const missing = repo.cli(["doctor"]);
  repo.write("AGENTS.md", `${RULE}\n`);
  repo.write("CLAUDE.md", "Responde en español.\n");
  const noImport = repo.cli(["doctor"]);
  repo.write("CLAUDE.md", "Responde en español.\n\n@AGENTS.md\n");
  const ok = repo.cli(["doctor"]);
  const bare = makeRepo().cli(["doctor"]);

  assert.match(missing.out, /· agents-md: falta la regla de versiones en AGENTS\.md; corre npx agent-kitchen apply/);
  assert.match(noImport.out, /· agents-md: CLAUDE\.md no importa AGENTS\.md/);
  assert.match(ok.out, /✓ agents-md: /);
  assert.doesNotMatch(`${missing.out}${noImport.out}`, /✗ agents-md/);
  assert.doesNotMatch(bare.out, /agents-md/);
});

test("own files keep every byte, in their own line endings, and a second run adds nothing", () => {
  const cases = [
    { name: "sin salto final", agents: "# App", claude: "Hola", wantAgents: `# App\n\n${RULE}\n`, wantClaude: "Hola\n\n@AGENTS.md\n" },
    { name: "vacíos", agents: "", claude: "", wantAgents: `${RULE}\n`, wantClaude: "@AGENTS.md\n" },
    { name: "CRLF", agents: "# App\r\nUsa pnpm.\r\n", claude: "Hola\r\n", wantAgents: `# App\r\nUsa pnpm.\r\n\r\n${RULE}\r\n`, wantClaude: "Hola\r\n\r\n@AGENTS.md\r\n" },
  ];
  for (const each of cases) {
    const repo = makeRepo();
    repo.write("package.json", { name: "app" });
    repo.write("AGENTS.md", each.agents);
    repo.write("CLAUDE.md", each.claude);

    const first = repo.cli(["--yes", ...ONLY]);
    const second = repo.cli(["--yes", ...ONLY]);

    assert.equal(first.status, 0, `${each.name}: ${first.err}`);
    assert.equal(text(repo, "AGENTS.md"), each.wantAgents, each.name);
    assert.equal(text(repo, "CLAUDE.md"), each.wantClaude, each.name);
    assert.match(second.out, /Todo al día/, each.name);
  }
});

test("a CLAUDE.md that links to AGENTS.md gets no import, so AGENTS.md never imports itself", () => {
  const repo = makeRepo();
  repo.write("package.json", { name: "app" });
  repo.write("AGENTS.md", "# App\n");
  symlinkSync("AGENTS.md", join(repo.main, "CLAUDE.md"));

  const r = repo.cli(["--yes", ...ONLY]);
  const doctor = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(text(repo, "AGENTS.md"), `# App\n\n${RULE}\n`);
  assert.match(doctor.out, /✓ agents-md: /);
});

test("when the flow fails to write package.json, the step writes nothing and says so", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "claude-cloud,claude-repo-guard,skills"], { env: { FAKE_FAIL: "issue-flow" } });

  assert.equal(repo.exists("package.json"), false);
  assert.equal(repo.exists("AGENTS.md"), false);
  assert.match(r.out, /sin package\.json: no se agregó nada/);
});
