// Tests of the skills-manager piece: agent-kitchen keeps the version of skills-manager in
// package.json at least at the one it needs, never lowers it, leaves a range alone, and
// runs the version the repo will have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installedRepo, makeRepo } from "./helpers.mjs";

const SM = "@ramon-sg/skills-manager";

// Everything but this piece and the skills, whose calls say which skills-manager runs.
const ONLY = ["--skip", "issue-flow,claude-cloud,claude-repo-guard,agents-md"];

// An installed repo whose package.json has this skills-manager (null: none).
function repoWith(spec, { flow = "0.2.0" } = {}) {
  const repo = installedRepo({ flow });
  const pkg = repo.read("package.json");
  if (spec === null) delete pkg.devDependencies[SM];
  else pkg.devDependencies[SM] = spec;
  repo.write("package.json", pkg);
  return repo;
}

// Fakes skills-manager installed in node_modules at a version.
const installed = (repo, version) => repo.write(`node_modules/${SM}/package.json`, { name: SM, version });

// The skills-manager spec each npx call of the last run used.
const specs = (repo) => repo.allCalls().map((args) => args.find((arg) => arg.startsWith(`${SM}@`))).filter(Boolean);

test("an exact version below the minimum is raised to it", () => {
  const repo = repoWith("1.1.0");

  const r = repo.cli(["--yes", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /skills-manager +1\.1\.0, bajo 1\.2\.0/);
  assert.match(r.out, /Subir skills-manager 1\.1\.0 → 1\.2\.0/);
  assert.equal(repo.read("package.json").devDependencies[SM], "1.2.0");
});

test("the flow's upgrade in the same run moves its skills with the raised version", () => {
  const repo = repoWith("1.1.0", { flow: "0.1.0" });

  const r = repo.cli(["--yes", "--skip", "claude-cloud,claude-repo-guard,agents-md"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls().filter((args) => args[1] === "update"), [
    [`${SM}@1.2.0`, "update", "close-pr"],
    [`${SM}@1.2.0`, "update", "pr-review-comments"],
  ]);
});

test("a missing skills-manager is added to devDependencies in alphabetical order", () => {
  const repo = repoWith(null);
  const pkg = repo.read("package.json");
  pkg.devDependencies.zod = "4.0.0";
  repo.write("package.json", pkg);

  const r = repo.cli(["--yes", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(Object.keys(repo.read("package.json").devDependencies), ["@ramon-sg/issue-flow", "@ramon-sg/github-rest", SM, "zod"]);
  assert.equal(repo.read("package.json").devDependencies[SM], "1.2.0");
});

test("a newer version is left alone, compared as numbers", () => {
  for (const version of ["1.2.0", "1.3.0", "1.10.0"]) {
    const repo = repoWith(version);
    const before = readFileSync(join(repo.main, "package.json"), "utf8");

    const r = repo.cli(["--dry-run", ...ONLY]);

    assert.equal(r.status, 0, r.err);
    assert.match(r.out, new RegExp(`skills-manager +${version.replace(/\./g, "\\.")}, al día`));
    assert.doesNotMatch(r.out, /skills-manager .*→/);
    assert.equal(readFileSync(join(repo.main, "package.json"), "utf8"), before);
  }
});

test("an exact version in package.json wins over an older one in node_modules", () => {
  const repo = repoWith("1.2.0");
  installed(repo, "1.1.0");

  const r = repo.cli(["--dry-run", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual([...new Set(specs(repo))], [`${SM}@1.2.0`]);
});

test("a range is left alone; it runs the version in node_modules, and warns only if that is too old", () => {
  const ranged = repoWith("^1.2.0");
  installed(ranged, "1.3.0");
  const r = ranged.cli(["--dry-run", ...ONLY]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual([...new Set(specs(ranged))], [`${SM}@1.3.0`]);
  assert.doesNotMatch(r.out, /bajo 1\.2\.0/);

  const lowRangeNewInstall = repoWith("^1.1.0");
  installed(lowRangeNewInstall, "1.3.0");
  assert.doesNotMatch(lowRangeNewInstall.cli(["--dry-run", ...ONLY]).out, /bajo 1\.2\.0/);

  const lowRange = repoWith("^1.1.0");
  const low = lowRange.cli(["--dry-run", ...ONLY]);
  assert.match(low.out, /skills-manager +package\.json tiene \^1\.1\.0, no una versión exacta; no se toca; corre 1\.1\.0, bajo 1\.2\.0/);
  assert.doesNotMatch(low.out, /skills-manager .*→/);
});

test("workspace: runs the version in node_modules, without a warning", () => {
  const repo = repoWith("workspace:*");
  installed(repo, "1.3.0");

  const r = repo.cli(["--dry-run", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual([...new Set(specs(repo))], [`${SM}@1.3.0`]);
  assert.doesNotMatch(r.out, /bajo/);
});

test("it raises the entry it reads: devDependencies before dependencies, and dependencies when it is only there", () => {
  const both = repoWith("1.1.0");
  const pkg = both.read("package.json");
  pkg.dependencies = { [SM]: "^1.0.0" };
  both.write("package.json", pkg);
  assert.equal(both.cli(["--yes", ...ONLY]).status, 0);
  assert.equal(both.read("package.json").devDependencies[SM], "1.2.0");
  assert.equal(both.read("package.json").dependencies[SM], "^1.0.0");

  const only = repoWith(null);
  only.write("package.json", { ...only.read("package.json"), dependencies: { [SM]: "1.1.0" } });
  assert.equal(only.cli(["--yes", ...ONLY]).status, 0);
  assert.equal(only.read("package.json").dependencies[SM], "1.2.0");
  assert.equal(only.read("package.json").devDependencies[SM], undefined);
});

test("package.json keeps its tabs, its line endings and its key order", () => {
  const repo = repoWith("1.1.0");
  const text = '{\r\n\t"name": "app",\r\n\t"devDependencies": {\r\n\t\t"zod": "4.0.0",\r\n\t\t"@ramon-sg/skills-manager": "1.1.0"\r\n\t},\r\n\t"private": true\r\n}\r\n';
  repo.write("package.json", text);

  const r = repo.cli(["--yes", ...ONLY]);

  assert.equal(r.status, 0, r.err);
  assert.equal(readFileSync(join(repo.main, "package.json"), "utf8"), text.replace('"1.1.0"', '"1.2.0"'));
});

test("the piece is not shown without package.json, nor without skills when they are left out; --dry-run writes nothing", () => {
  const empty = makeRepo();
  assert.doesNotMatch(empty.cli(["--dry-run", ...ONLY]).out, /skills-manager +/);

  const node = makeRepo();
  node.write("package.json", { name: "app" });
  assert.doesNotMatch(node.cli(["--dry-run", "--skip", "skills,agents-md"]).out, /skills-manager +/);
  const withManifest = makeRepo();
  withManifest.write("package.json", { name: "app" });
  withManifest.write(".agents/skills.json", { sources: [] });
  assert.match(withManifest.cli(["--dry-run", "--skip", "skills,agents-md"]).out, /skills-manager +no está en package\.json/);
  const offered = node.cli(["--dry-run", ...ONLY]);
  assert.match(offered.out, /\[x\] Agregar skills-manager 1\.2\.0 a package\.json/);
  assert.deepEqual(node.read("package.json"), { name: "app" });
});

test("doctor fails below the minimum and passes at or above it", () => {
  const low = repoWith("1.1.0");
  const r = low.cli(["doctor"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /✗ skills-manager: 1\.1\.0, bajo 1\.2\.0, el mínimo de agent-kitchen: corre npx agent-kitchen apply/);

  const noSkills = makeRepo();
  noSkills.write("package.json", { devDependencies: { [SM]: "1.1.0" } });
  assert.doesNotMatch(noSkills.cli(["doctor"]).out, /skills-manager:/);

  const ok = repoWith("1.3.0");
  const good = ok.cli(["doctor"]);
  assert.equal(good.status, 0, good.out);
  assert.match(good.out, /✓ skills-manager: 1\.3\.0/);
});
