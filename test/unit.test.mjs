// Unit tests of the pieces that need no repo: comparing versions, and the menu's options
// (rendering @clack/prompts is not tested; the menu was run by hand in a terminal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { menuOptions } from "../dist/menu.js";
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
