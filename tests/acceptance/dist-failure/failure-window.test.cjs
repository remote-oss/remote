"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/acceptance/suite-failure/failure-window.test.ts
var import_node_assert = require("node:assert");
var vscode = __toESM(require("vscode"));

// tests/acceptance/suite-local/script.ts
var import_node_fs = require("node:fs");
function fileNamed(variable) {
  const file = process.env[variable];
  if (file === void 0 || file === "") {
    throw new Error(`${variable} is not set; run the tests with the harness`);
  }
  return file;
}
function runOf(entries, recordFile) {
  function record() {
    if (!(0, import_node_fs.existsSync)(recordFile)) {
      return [];
    }
    return (0, import_node_fs.readFileSync)(recordFile, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
  }
  return {
    record,
    assertAllUsed: () => {
      const used = record().filter((line) => line.matched).length;
      if (used < entries.length) {
        throw new Error(
          `${String(entries.length - used)} of ${String(entries.length)} script entries were not used`
        );
      }
    }
  };
}
function launchScript() {
  const { entries } = JSON.parse(
    (0, import_node_fs.readFileSync)(fileNamed("REMOTE_OSS_ACCEPTANCE_SCRIPT"), "utf8")
  );
  return runOf(entries, fileNamed("REMOTE_OSS_ACCEPTANCE_RECORD"));
}

// tests/acceptance/suite-failure/cases.json
var cases_default = {
  cases: [
    {
      alias: "refused",
      script: [
        {
          surface: "failureDialog",
          match: '"refused"',
          answer: "dismiss"
        },
        {
          surface: "mitigationPick",
          match: "Pick an action to help resolve the problem.",
          answer: "dismiss"
        }
      ],
      dialog: 'Could not establish connection to "refused".'
    },
    {
      alias: "nowhere",
      script: [
        {
          surface: "failureDialog",
          match: '"nowhere"',
          answer: "dismiss"
        },
        {
          surface: "mitigationPick",
          match: "Pick an action to help resolve the problem.",
          answer: "dismiss"
        }
      ],
      dialog: 'Could not establish connection to "nowhere": Could not resolve hostname.'
    },
    {
      alias: "stranger",
      script: [
        {
          surface: "pick",
          match: "has fingerprint",
          answer: "dismiss"
        },
        {
          surface: "failureDialog",
          match: '"stranger"',
          answer: "dismiss"
        },
        {
          surface: "mitigationPick",
          match: "Pick an action to help resolve the problem.",
          answer: "dismiss"
        }
      ],
      dialog: 'Could not establish connection to "stranger".'
    }
  ]
};

// tests/acceptance/suite-failure/failure-window.test.ts
var cases = cases_default.cases;
var failure = cases.find(
  (candidate) => vscode.workspace.workspaceFolders?.[0]?.uri.authority === `ssh-remote+${candidate.alias}`
);
async function recordAfterDialog() {
  const launched = launchScript();
  for (let attempt = 0; attempt < 180; attempt++) {
    const record = launched.record();
    if (record.some((line) => line.surface === "mitigationPick")) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return launched.record();
}
describe(`a failed connect to "${failure?.alias ?? "unknown"}" (ruling 1)`, () => {
  let record = [];
  before(async () => {
    record = await recordAfterDialog();
  });
  it("F-2601 5.0: the window is one of the failing connects", () => {
    (0, import_node_assert.strictEqual)(failure === void 0, false);
  });
  it("F-2601 AC-1, AC-3, AC-6, AC-9: the dialog names the alias, with the reason of the failure", () => {
    (0, import_node_assert.strictEqual)(
      record.find((line) => line.surface === "failureDialog")?.question,
      failure?.dialog
    );
  });
  it("F-2601 AC-12, AC-13, ruling 5: dismissing the dialog opened the pick of actions, and every question was the next one of the script", () => {
    (0, import_node_assert.deepStrictEqual)(
      record.map((line) => [line.surface, line.matched]),
      failure?.script.map((entry) => [entry.surface, true])
    );
  });
});
