import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const coo = await readFile(new URL("../src/coo-platform.ts", import.meta.url), "utf8");

test("COO exposes a direct email/password sign-in form when no session exists", () => {
  assert.match(coo, /id="cooLogin" class="card login-card"/);\n  assert.doesNotMatch(coo, /id="cooLogin" class="card login-card" hidden/);
  assert.match(coo, /id="cooLoginEmail" type="email"/);
  assert.match(coo, /id="cooLoginPassword" type="password"/);
  assert.match(coo, /id="cooLoginButton"/);
  assert.match(coo, /if\(!session\(\)\?\.access_token\)loginPrompt\("Authentification requise\."\)/);
  assert.match(coo, /function loginPrompt\(text\)\{message\(text,true\);showLogin\(\)/);
});

test("COO sign-in uses the shared Auth session endpoint and restores the workspace", () => {
  assert.match(coo, /fetch\("\/auth\/session",\{method:"POST"/);
  assert.match(coo, /JSON\.stringify\(\{action:"signin",email,password\}\)/);
  assert.match(coo, /localStorage\.setItem\("afe-v09-session",JSON\.stringify\(data\)\)/);
  assert.match(coo, /await loadWorkspaceList\(\)/);
  assert.match(coo, /cooLoginPassword.*addEventListener\("keydown"/);
});

test("COO displays authentication errors and reveals sign-in again after an expired session", () => {
  assert.match(coo, /error\.textContent=e instanceof Error\?e\.message:"Erreur de connexion\."/);
  assert.match(coo, /if\(r\.status===401\)\{localStorage\.removeItem\("afe-v09-session"\);loginPrompt\("Session expirée\."\);\}/);
});

test("COO login click handler is isolated before dashboard scripts and reports Auth failures", () => {
  const handler = coo.indexOf('button.addEventListener("click", async function (event)');
  const dashboard = coo.indexOf('<script src="https://cdn.jsdelivr.net/npm/jspdf');
  assert.ok(handler >= 0, "isolated click handler must exist");
  assert.ok(dashboard > handler, "isolated handler must run before dashboard scripts");
  assert.match(coo, /event\.stopImmediatePropagation\(\)/);
  assert.match(coo, /fetch\("\/auth\/session"/);
  assert.match(coo, /error\.textContent = failure && failure\.message/);
  assert.match(coo, /localStorage\.setItem\("afe-v09-session", JSON\.stringify\(data\)\)/);
});
