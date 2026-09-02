import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("alur akun menyediakan daftar, masuk, dan keluar", () => {
  assert.match(htmlSource, /id="signInTab"/);
  assert.match(htmlSource, /id="signUpTab"/);
  assert.match(htmlSource, /id="logoutButton"/);
  assert.match(appSource, /clerk\.mountSignIn/);
  assert.match(appSource, /clerk\.mountSignUp/);
  assert.match(appSource, /clerk\.signOut/);
  assert.match(appSource, /isSameAuthenticatedUser\(currentUser, user\)/);
});

test("semua endpoint tugas memerlukan sesi pengguna", () => {
  assert.match(serverSource, /app\.get\("\/api\/tasks", requireAuth/);
  assert.match(serverSource, /app\.post\("\/api\/tasks", requireAuth/);
  assert.match(serverSource, /app\.patch\("\/api\/tasks\/:id", requireAuth/);
  assert.match(serverSource, /app\.delete\("\/api\/tasks\/:id", requireAuth/);
  assert.match(serverSource, /getAuth\(request\)/);
});

test("query baca, ubah, dan hapus selalu dibatasi oleh user_id", () => {
  assert.match(serverSource, /WHERE user_id = \$1 ORDER BY/);
  assert.match(serverSource, /WHERE id = \$1 AND user_id = \$2/);
  assert.match(serverSource, /WHERE id = \$8 AND user_id = \$9/);
  assert.match(serverSource, /INSERT INTO focusboard_tasks \(id, workspace_code, user_id/);
  assert.doesNotMatch(serverSource, /cors\(/);
});

test("client tidak lagi mengirim kode ruang kerja sebagai otorisasi", () => {
  assert.doesNotMatch(appSource, /\?workspace=|workspaceCode|claim-legacy/);
  assert.doesNotMatch(serverSource, /getWorkspaceCode|validateWorkspaceCode|claim-legacy/);
  assert.doesNotMatch(serverSource, /SET user_id/);
});

test("loading dan kegagalan sinkronisasi terlihat oleh pengguna", () => {
  assert.match(appSource, /Memuat tugas Anda/);
  assert.match(appSource, /Sinkronisasi gagal/);
  assert.match(appSource, /Perubahan belum tersimpan/);
  assert.match(htmlSource, /id="syncNotice"/);
});

test("respons API privat dan fetch tugas tidak boleh disimpan cache", () => {
  assert.match(serverSource, /app\.use\("\/api"/);
  assert.match(serverSource, /setHeader\("Cache-Control", "no-store"\)/);
  assert.match(appSource, /cache: "no-store"/);
});

test("cache lokal dipisahkan untuk setiap akun", () => {
  assert.match(appSource, /USER_STORAGE_PREFIX/);
  assert.match(appSource, /currentUser\?\.id/);
  assert.match(appSource, /saveTaskCache/);
});

test("migrasi cache lama dapat dilanjutkan setelah kegagalan parsial", () => {
  assert.match(appSource, /const persistedIds = new Set/);
  assert.match(appSource, /legacyTasks\.filter\(\(task\) => !persistedIds\.has\(task\.id\)\)/);
  assert.match(appSource, /legacyTasks\.every\(\(task\) => finalIds\.has\(task\.id\)\)/);
  assert.match(serverSource, /verifyDatabaseSchema/);
});