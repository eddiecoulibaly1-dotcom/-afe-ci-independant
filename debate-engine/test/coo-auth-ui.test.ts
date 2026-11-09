import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const coo = await readFile(new URL("../src/coo-platform.ts", import.meta.url), "utf8");

test("COO exposes a direct email/password sign-in form when no session exists", () => {
  assert.match(coo, /id="cooLogin" class="card login-card"/);
  assert.doesNotMatch(coo, /id="cooLogin" class="card login-card" hidden/);
  assert.match(coo, /id="cooLoginEmail" type="email"/);
  assert.match(coo, /id="cooLoginPassword" type="password"/);
  assert.match(coo, /id="cooLoginButton"/);
  assert.match(coo, /const startupSession=session\(\);if\(startupSession\?\.access_token\)/);
});


test("COO does not show the login form over an existing authenticated session", () => {
  assert.match(coo, /const startupSession=session\(\);if\(startupSession\?\.access_token\)\{\$\("cooLogin"\)\.hidden=true/);
  assert.match(coo, /Session active, mais impossible de charger l’espace de travail/);
  assert.match(coo, /if\(!session\(\)\?\.access_token\)\{loginPrompt\("Session expirée/);
  assert.match(coo, /else\{\$\("cooLogin"\)\.hidden=true/);
});

test("COO sign-in uses the shared Auth session endpoint and restores the workspace", () => {
  assert.match(coo, /fetch\("\/auth\/session",\{method:"POST"/);
  assert.match(coo, /JSON\.stringify\(\{action:"signin",email,password\}\)/);
  assert.match(coo, /localStorage\.setItem\("afe-v09-session",JSON\.stringify\(data\)\)/);
  assert.match(coo, /await loadWorkspaceList\(\)/);
  assert.match(coo, /cooLoginPassword.*addEventListener\("keydown"/);
});

test("COO refreshes expiring sessions and retries a request once after 401", () => {
  assert.match(coo, /async function refreshSession\(\)/);
  assert.match(coo, /action:"refresh",refresh_token:current\.refresh_token/);
  assert.match(coo, /expiry\*1000<Date\.now\(\)\+60000/);
  assert.match(coo, /if\(r\.status===401&&s\.refresh_token\)/);
  assert.match(coo, /localStorage\.setItem\("afe-v09-session",JSON\.stringify\(data\)\)/);
});

test("COO uses one login click handler without a competing capture listener", () => {
  assert.match(coo, /\$\("cooLoginButton"\)\.onclick=loginFromCoo/);
  assert.doesNotMatch(coo, /stopImmediatePropagation\(\)/);
  assert.doesNotMatch(coo, /button\.addEventListener\("click", async function \(event\)/);
  assert.match(coo, /async function loginFromCoo\(\)/);
});

test("COO workspace loading has a bounded timeout and explicit success/error states", () => {
  assert.match(coo, /new AbortController\(\),timer=setTimeout\(\(\)=>controller\.abort\(\),15000\)/);
  assert.match(coo, /Le serveur met trop de temps à répondre/);
  assert.match(coo, /Espace de travail chargé/);
  assert.match(coo, /Échec du chargement COO/);
  assert.match(coo, /const rendered=await render\(\);if\(!rendered\)return false/);
});

test("COO inline browser JavaScript parses before deployment", () => {
  const scripts = [...coo.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1, "COO must contain an inline application script");
  const applicationScript = scripts[scripts.length - 1][1];
  assert.ok(applicationScript.includes('$("cooLoginButton").onclick=loginFromCoo'));
  assert.doesNotThrow(() => new Script(applicationScript), "COO browser script must be syntactically valid");
});

test("COO export libraries cannot block authentication script startup", () => {
  assert.match(coo, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf/);
  assert.match(coo, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/docx/);
});
