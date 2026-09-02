import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameAuthenticatedUser } from "../auth-utils.js";

test("kondisi awal tanpa pengguna tetap menjalankan alur signed-out", () => {
  assert.equal(isSameAuthenticatedUser(undefined, undefined), false);
  assert.equal(isSameAuthenticatedUser(undefined, null), false);
  assert.equal(isSameAuthenticatedUser(null, null), false);
});

test("hanya pengguna terautentikasi dengan ID sama yang dilewati", () => {
  assert.equal(isSameAuthenticatedUser({ id: "user-a" }, { id: "user-a" }), true);
  assert.equal(isSameAuthenticatedUser({ id: "user-a" }, { id: "user-b" }), false);
  assert.equal(isSameAuthenticatedUser({ id: "user-a" }, null), false);
});