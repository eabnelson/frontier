import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.deepEqual(Object.keys(packageJson.bin), ["ft"]);
assert.equal(packageJson.bin.ft, "./bin/ft.mjs");
