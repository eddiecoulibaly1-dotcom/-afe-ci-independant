import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("autonomous debate result exposes readable report, exports and human approval",async()=>{
 const source=await readFile(new URL("../src/team-platform.ts",import.meta.url),"utf8");
 assert.match(source,/Rapport du débat/);
 assert.match(source,/Copier le rapport/);
 assert.match(source,/Télécharger Word/);
 assert.match(source,/Exporter PDF/);
 assert.match(source,/window\.print\(\)/);
 assert.match(source,/aria-label="Copier le rapport"/);
 assert.match(source,/approveArbitration/);
 assert.match(source,/rejectArbitration/);
 assert.match(source,/\/approval/);\n assert.match(source,/delibNewMissionTitle/);\n assert.match(source,/evidenceDiscovery:true/);
});
