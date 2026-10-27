// Unit tests of the pieces that need no repo: comparing versions, and the menu's options
// and keeping own skills (rendering @clack/prompts is not tested; the menus were run by hand in a terminal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { menuOptions, skillOptions } from "../dist/menu.js";
import { keepOwn } from "../dist/pieces/skills.js";
import { compareVersions } from "../dist/tools.js";

test("versions compare by number, not as text", () => {
  assert.ok(compareVersions("0.10.0", "0.9.1") > 0);
  assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
  assert.equal(compareVersions("2.3.4", "2.3.4"), 0);
});

test("the menu starts with the suggested steps ticked, in the steps' order", () => {
  const steps = [
    { piece: "issue-flow", label: "a", checked: true, run: () => true },
    { piece: "skills", label: "b", checked: false, run: () => true },
    { piece: "claude-cloud", label: "c", checked: true, run: () => true },
  ];

  const { options, initialValues } = menuOptions(steps);

  assert.deepEqual(initialValues, [0, 2]);
  assert.deepEqual(options.map((option) => option.label), ["a", "b", "c"]);
});

test("keeping an own skill also drops the skills that require it", () => {
  const candidates = [
    { id: "a/close-pr", name: "close-pr", catalog: "a", description: "", skills: ["close-pr", "pr-review-comments"] },
    { id: "a/pr-review-comments", name: "pr-review-comments", catalog: "a", description: "", skills: ["pr-review-comments"] },
    { id: "a/planning", name: "planning", catalog: "a", description: "", skills: ["planning"] },
  ];
  const pick = { candidates, picked: candidates.map((candidate) => candidate.id), replace: ["pr-review-comments"] };

  const kept = keepOwn(pick, ["pr-review-comments"]);

  assert.deepEqual(kept.picked, ["a/planning"]);
  assert.deepEqual(kept.replace, []);
});

test("the skills menu groups by catalog and cuts long descriptions", () => {
  const long = "x".repeat(100);

  const groups = skillOptions([
    { id: "a/one", name: "one", catalog: "a", description: long, skills: ["one"] },
    { id: "b/two", name: "two", catalog: "b", description: "corta", skills: ["two"] },
  ]);

  assert.deepEqual(Object.keys(groups), ["a", "b"]);
  assert.equal(groups.a[0].hint.length, 70);
  assert.equal(groups.b[0].hint, "corta");
});
