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

// tests/acceptance/suite-reconnect/reconnect.test.ts
var import_node_assert = require("node:assert");
var vscode = __toESM(require("vscode"));

// tests/acceptance/suite/host-server.ts
var import_node_fs = require("node:fs");
var path = __toESM(require("node:path"));

// tests/acceptance/suite/harness.ts
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
function harnessVariable(name) {
  const value = process.env[name];
  if (value === void 0 || value === "") {
    throw new Error(
      `${name} is not set; run the tests with pnpm test:acceptance`
    );
  }
  return value;
}
async function onHost(...command) {
  const { stdout } = await execFileAsync("docker", [
    "exec",
    "--user",
    "harness",
    harnessVariable("HARNESS_CONTAINER"),
    ...command
  ]);
  return stdout;
}

// tests/acceptance/suite/host-server.ts
var DATA_FOLDER = "/home/harness/.vscodium-server-insiders";
async function hostServer() {
  const commits = (await onHost("ls", "-1", `${DATA_FOLDER}/bin`)).split("\n").filter((name) => name !== "");
  const processId = (await onHost("cat", `${DATA_FOLDER}/.${commits[0] ?? ""}.pid`)).trim();
  return { commits, processId };
}
function keptFile() {
  return path.join(process.env.HARNESS_RUN_FOLDER ?? "", "first-server.json");
}
function keptServer() {
  return JSON.parse((0, import_node_fs.readFileSync)(keptFile(), "utf8"));
}

// tests/acceptance/suite-reconnect/reconnect.test.ts
describe("a second launch on the same host (ruling 2)", () => {
  it("#140: the second window is on ssh-remote", () => {
    (0, import_node_assert.strictEqual)(vscode.env.remoteName, "ssh-remote");
  });
  it("#140, F-2103 BR-8: the second connect installed nothing new", async () => {
    (0, import_node_assert.deepStrictEqual)((await hostServer()).commits, keptServer().commits);
  });
  it("#140, F-2103 BR-8: the second connect reused the running server", async () => {
    (0, import_node_assert.strictEqual)((await hostServer()).processId, keptServer().processId);
  });
});
