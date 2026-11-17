import assert from "node:assert/strict";
import { parseToolArgs } from "./zen-devtools.js";

const tool = {
  name: "click_by_uid",
  inputSchema: {
    properties: { uid: { type: "string" }, dblclick: { type: "boolean" }, timeout: { type: "number" }, keys: { type: "array" } },
    required: ["uid"],
  },
};
assert.deepEqual(parseToolArgs(tool, ["1_5"]), { uid: "1_5" });
assert.deepEqual(parseToolArgs(tool, ["--dblclick", "1_5"]), { dblclick: true, uid: "1_5" });
assert.deepEqual(parseToolArgs(tool, ["1_5", "--dblclick", "false", "--timeout", "3"]), { uid: "1_5", dblclick: false, timeout: 3 });
assert.deepEqual(parseToolArgs(tool, ["1_5", "--keys", '["a","b"]']), { uid: "1_5", keys: ["a", "b"] });
assert.throws(() => parseToolArgs(tool, []), /missing <uid>/);
assert.throws(() => parseToolArgs(tool, ["1_5", "extra"]), /unexpected argument/);
assert.throws(() => parseToolArgs(tool, ["1_5", "--nope", "x"]), /unknown option/);
console.log("ok");
