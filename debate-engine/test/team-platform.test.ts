import test from "node:test";
import assert from "node:assert/strict";
import { canManageWorkspace } from "../src/team-platform.js";
test("owner can manage non-owner roles but cannot replace owner via role editing",()=>{assert.equal(canManageWorkspace("owner","admin","editor"),true);assert.equal(canManageWorkspace("owner","owner","admin"),false);assert.equal(canManageWorkspace("owner","viewer","owner"),false);});
test("admin can manage only editor and viewer members",()=>{assert.equal(canManageWorkspace("admin","editor","viewer"),true);assert.equal(canManageWorkspace("admin","viewer","editor"),true);assert.equal(canManageWorkspace("admin","admin","viewer"),false);assert.equal(canManageWorkspace("admin","owner","viewer"),false);});
test("editor and viewer cannot manage membership",()=>{for(const role of ["editor","viewer"] as const){assert.equal(canManageWorkspace(role,"viewer","editor"),false);assert.equal(canManageWorkspace(role,"editor"),false);}});
