import assert from "node:assert/strict";
import { Script } from "node:vm";
import test from "node:test";
import { LAB_HTML } from "../src/lab-v107.js";

test("strategic report UI script parses as valid JavaScript", () => {
  const marker = "let speechQueue=[],speechIndex=0,reportText='',activeUtterance=null;";
  const markerIndex = LAB_HTML.indexOf(marker);
  const start = LAB_HTML.lastIndexOf("<script>", markerIndex) + "<script>".length;
  assert.ok(markerIndex >= 0 && start >= "<script>".length, "report UI script marker must be present");
  const end = LAB_HTML.indexOf("</script>", start);
  assert.notEqual(end, -1, "report UI script must be closed");
  const script = LAB_HTML.slice(start, end);
  assert.doesNotThrow(() => new Script(script), "report UI script must parse");
});

test("completed debates expose report generation, executive summary and audio controls", () => {
  for (const label of [
    "Générer le rapport stratégique complet",
    "Synthèse exécutive",
    "Écouter le rapport",
    "Pause",
    "Reprendre",
    "Arrêter",
    "Télécharger en PDF",
    "Télécharger en Word"
  ]) {
    assert.ok(LAB_HTML.includes(label), `missing UI control or section: ${label}`);
  }
  assert.ok(LAB_HTML.includes("/report"), "report generation endpoint must be wired");
});
