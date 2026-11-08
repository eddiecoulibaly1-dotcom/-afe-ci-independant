import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

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

test("COO uses one login click handler without a competing capture listener", () => {
  assert.match(coo, /\$\("cooLoginButton"\)\.onclick=loginFromCoo/);
  assert.doesNotMatch(coo, /stopImmediatePropagation\(\)/);
  assert.doesNotMatch(coo, /button\.addEventListener\("click", async function \(event\)/);
  assert.match(coo, /async function loginFromCoo\(\)/);
  assert.match(coo, /await loadWorkspaceList\(\)/);
});

test("COO workspace loading has a bounded timeout and a visible progress message", () => {
  assert.match(coo, /new AbortController\(\),timer=setTimeout\(\(\)=>controller\.abort\(\),12000\)/);
  assert.match(coo, /Le serveur met trop de temps à répondre/);
  assert.match(coo, /Session reconnue\. Récupération de tes espaces de travail/);
});

test("COO inline browser JavaScript parses before deployment", () => {
  const scripts = [...coo.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
  assert.ok(scripts.length >= 1, "COO must contain an inline application script");
  const applicationScript = scripts[scripts.length - 1][1];
  assert.ok(applicationScript.includes('$("cooLoginButton").onclick=loginFromCoo'));
  assert.doesNotThrow(() => new Script(applicationScript), "COO browser script must be syntactically valid");
});

test("COO export libraries cannot block authentication script startup", () => {
  assert.match(coo, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf/);
  assert.match(coo, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/docx/);
});
