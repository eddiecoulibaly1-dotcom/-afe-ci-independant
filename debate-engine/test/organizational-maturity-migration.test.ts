import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";\nimport {Script} from "node:vm";
const migration=readFileSync(new URL("../supabase/migrations/20261127100000_afe_org_maturity_learning_improvement.sql",import.meta.url),"utf8");
const api=readFileSync(new URL("../src/coo-maturity-api.ts",import.meta.url),"utf8");
const ui=readFileSync(new URL("../src/coo-maturity-ui.ts",import.meta.url),"utf8");
const server=readFileSync(new URL("../src/server.ts",import.meta.url),"utf8");\nconst uiHtml=readFileSync(new URL("../src/coo-maturity-ui.ts",import.meta.url),"utf8");
test("E10 persistence migration creates workspace-scoped tables and indexes",()=>{for(const table of ["afe_org_health_snapshots","afe_org_learning_memory","afe_org_improvement_proposals","afe_org_improvement_proposal_events"])assert.match(migration,new RegExp("create table if not exists public."+table));assert.match(migration,/unique\(workspace_id,proposal_id\)/);assert.match(migration,/enable row level security/);assert.match(migration,/revoke all .* from anon,authenticated/);});
test("E10 governance audit is append-only and route enforces role gates",()=>{assert.match(migration,/proposal_events_immutable/);assert.match(migration,/before update or delete/);assert.match(api,/Editor role required/);assert.match(api,/dgActor:dg/);assert.match(api,/workspace_id=eq\./);});
\ntest("E10 UI inline JavaScript parses and route is wired",()=>{const html=uiHtml.slice(uiHtml.indexOf("String.raw\u0060")+9);const script=html.slice(html.indexOf("<script>")+8,html.indexOf("</script>"));assert.ok(script.length>100);assert.doesNotThrow(()=>new Script(script));assert.match(server,/coo\\/maturity/);assert.match(uiHtml,/Soumettre/);assert.match(uiHtml,/DG approuver/);});\n