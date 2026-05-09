const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getCombinedOutput,
  assertNoTunneldFailure,
  isTransientError,
} = require("./runtime.cjs");

test("getCombinedOutput merges stdout and stderr", () => {
  const out = getCombinedOutput({ stdout: "a", stderr: "b" });
  assert.equal(out.includes("a"), true);
  assert.equal(out.includes("b"), true);
});

test("assertNoTunneldFailure throws when tunnel is missing", () => {
  assert.throws(
    () => assertNoTunneldFailure({ stdout: "", stderr: "Unable to connect to Tunneld" }),
    /iOS developer tunnel is required/,
  );
});

test("isTransientError detects timeout style errors", () => {
  const result = isTransientError({ stderr: "request timed out", stdout: "" });
  assert.equal(result, true);
});
