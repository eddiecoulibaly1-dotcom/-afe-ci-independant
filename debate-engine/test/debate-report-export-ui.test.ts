import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("autonomous debate result exposes readable report and export actions",async()=>{
 const source=await readFile(new URL("../src/team-platform.ts",import.meta.url),"utf8");
 assert.match(source,/Rapport du débat/);
 assert.match(source,/Copier le rapport/);
 assert.match(source,/Télécharger Word/);
 assert.match(source,/Exporter PDF/);
 assert.match(source,/window\.print\(\)/);
 assert.match(source,/aria-label="Copier le rapport"/);\n assert.match(source,/approveArbitration/);\n assert.match(source,/rejectArbitration/);\n assert.match(source,/deliberations\\/\"\+encodeURIComponent\\(b.dataset.delibDetail\\)\+\"\\/approval/);
});
