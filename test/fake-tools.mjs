// Fake npx and npm for the tests: they log each call (program, arguments, folder) to
// FAKE_LOG and do the little of each tool that agent-kitchen reads back afterwards.
//  - npm view <pkg> version prints FAKE_NPM's entry for <pkg> (a JSON map), or fails.
//  - issue-flow init writes its dev dependencies and .agents/flow.json; upgrade moves its
//    own version; doctor --json prints FAKE_FLOW_DOCTOR.
//  - claude-cloud init writes .claude/cloud.json at its version.
//  - claude-repo-guard install writes its manifest at the tag's version; doctor --json prints
//    FAKE_GUARD_DOCTOR.
//  - skills-manager add --candidates prints FAKE_CANDIDATES; init writes a manifest; check
//    fails with FAKE_CHECK_FAIL; update takes one name, like the real one (which ignores the
//    rest), and moves that skill in the lock to its catalog's ref, or to FAKE_UPDATE_TAG.
// Any npx call whose arguments contain FAKE_FAIL exits 1.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const program = process.env.FAKE_AS === "npm" ? "npm" : "npx";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ program, args, cwd: process.cwd() })}\n`);

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};

if (program === "npm") {
  const versions = JSON.parse(process.env.FAKE_NPM ?? "{}");
  const version = versions[args[1]];
  if (args[0] !== "view" || version === undefined) {
    process.stderr.write("npm error 404 Not Found\n");
    process.exit(1);
  }
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

const [, spec, command, ...rest] = args;
if (process.env.FAKE_FAIL && args.join(" ").includes(process.env.FAKE_FAIL)) process.exit(1);
const cwd = process.cwd();

if (spec.startsWith("@ramon-sg/issue-flow@")) {
  const version = spec.split("@").at(-1);
  const pkgFile = join(cwd, "package.json");
  const pkg = readJson(pkgFile) ?? {};
  if (command === "init") {
    pkg.devDependencies = { ...pkg.devDependencies, "@ramon-sg/issue-flow": version, "@ramon-sg/github-rest": "0.2.1", "@ramon-sg/skills-manager": "1.1.0" };
    writeJson(pkgFile, pkg);
    if (!existsSync(join(cwd, ".agents", "flow.json"))) writeJson(join(cwd, ".agents", "flow.json"), {});
  }
  if (command === "upgrade") {
    pkg.devDependencies = { ...pkg.devDependencies, "@ramon-sg/issue-flow": version };
    writeJson(pkgFile, pkg);
  }
  if (command === "doctor") process.stdout.write(process.env.FAKE_FLOW_DOCTOR ?? '[{"name":".agents/flow.json","ok":true,"detail":"valid"}]');
} else if (spec.startsWith("@ramon-sg/claude-cloud@") && command === "init") {
  const version = spec.split("@").at(-1);
  writeJson(join(cwd, ".claude", "cloud.json"), { version: version === "1" ? "1.0.0" : version });
} else if (spec.startsWith("github:ramon-sg/claude-repo-guard")) {
  if (command === "install") writeJson(join(cwd, ".claude", "repo-guard.manifest.json"), { version: spec.includes("#v") ? spec.split("#v")[1] : "0.0.0" });
  if (command === "doctor") process.stdout.write(process.env.FAKE_GUARD_DOCTOR ?? "[]");
} else if (spec.startsWith("@ramon-sg/skills-manager@")) {
  if (rest.includes("--candidates")) process.stdout.write(process.env.FAKE_CANDIDATES ?? "[]");
  else if (command === "init") writeJson(join(cwd, ".agents", "skills.json"), { sources: [] });
  else if (command === "check" && process.env.FAKE_CHECK_FAIL) process.exit(1);
  else if (command === "update") {
    if (rest.length !== 1) {
      process.stderr.write("fake skills-manager: update takes one name\n");
      process.exit(2);
    }
    const manifest = readJson(join(cwd, ".agents", "skills.json"));
    const lockFile = join(cwd, manifest?.paths?.lock ?? ".agents/skills.lock.json");
    const lock = readJson(lockFile);
    const entry = lock.skills[rest[0]];
    const source = manifest.sources.find((item) => entry.source === `catalog:${item.catalog}`);
    entry.tag = source?.ref ?? process.env.FAKE_UPDATE_TAG ?? "v0.2.0";
    writeJson(lockFile, lock);
  }
}
