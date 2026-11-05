import test from "node:test";
import assert from "node:assert/strict";
import { canManageWorkspace } from "../src/team-platform.js";
test("owner can manage non-owner roles but cannot replace owner via role editing",()=>{assert.equal(canManageWorkspace("owner","admin","editor"),true);assert.equal(canManageWorkspace("owner","owner","admin"),false);assert.equal(canManageWorkspace("owner","viewer","owner"),false);});
test("admin can manage only editor and viewer members",()=>{assert.equal(canManageWorkspace("admin","editor","viewer"),true);assert.equal(canManageWorkspace("admin","viewer","editor"),true);assert.equal(canManageWorkspace("admin","admin","viewer"),false);assert.equal(canManageWorkspace("admin","owner","viewer"),false);});
test("editor and viewer cannot manage membership",()=>{for(const role of ["editor","viewer"] as const){assert.equal(canManageWorkspace(role,"viewer","editor"),false);assert.equal(canManageWorkspace(role,"editor"),false);}});

import { isRole } from "../src/team-platform.js";
test("unknown and malformed roles are rejected rather than treated as privileged",()=>{
  for(const role of ["custom_admin","superuser","",null,undefined,{},4]) assert.equal(isRole(role),false);
});
test("only the four explicit built-in roles are accepted by the baseline policy",()=>{
  for(const role of ["owner","admin","editor","viewer"]) assert.equal(isRole(role),true);
});

test("membership mutation policies are removed from direct authenticated Data API access",async()=>{
  const {readFile}=await import("node:fs/promises");
  const migration=await readFile(new URL("../supabase/migrations/20261105210000_team_membership_server_only.sql",import.meta.url),"utf8");
  assert.match(migration,/DROP POLICY IF EXISTS debate_workspace_members_admin_insert/i);
  assert.match(migration,/DROP POLICY IF EXISTS debate_workspace_members_admin_update/i);
  assert.match(migration,/DROP POLICY IF EXISTS debate_workspace_members_admin_delete/i);
});
test("workspace document bucket is private and constrained to 50 MB",async()=>{
  const {readFile}=await import("node:fs/promises");
  const migration=await readFile(new URL("../supabase/migrations/20261105213000_team_private_documents_bucket.sql",import.meta.url),"utf8");
  assert.match(migration,/afe-ci-team-documents/);
  assert.match(migration,/false/);
  assert.match(migration,/52428800/);
});
