import { test } from "node:test";
import assert from "node:assert/strict";
import { MATURITY_PROGRAMME_V1, assertCanonicalMaturityPlan, canonicalizeMaturityPlan, isMaturityProgrammeInstruction } from "../src/coo-maturity-contract.js";

const mandates:Record<string,string>={
 "risques-controle":"Identifie et évalue les risques, surveille les contrôles et KRI. Dispose d'un droit d'escalade directe à la DG et conserve son indépendance de jugement.",
 "operations-missions":"Coordonne l'exécution quotidienne des missions autorisées, les tâches, les dépendances et les plans de rattrapage.",
 "audit-qualite":"Vérifie la qualité des livrables, la traçabilité, la complétude des contrôles et la conformité aux procédures, sans se substituer à l'audit interne.",
 "gouvernance-conformite":"Contrôle les délégations, la conformité, les conflits d'intérêts et la séparation des fonctions. Dispose d'un droit d'escalade directe à la DG.",
 "evidence-intelligence":"Collecte les sources autorisées, vérifie la provenance, conserve les empreintes et qualifie la relation entre preuves et constats.",
 "documentation-reporting":"Produit les dossiers, rapports, synthèses, exports et archives institutionnelles.",
 "secretariat-general":"Enregistre les mandats, prépare les dossiers, suit les jalons, les affectations, les échéances et la complétude documentaire.",
 "infrastructure-securite":"Assure l'architecture, la disponibilité, la sécurité, les habilitations et la séparation des environnements."
};
const departments=MATURITY_PROGRAMME_V1.map(x=>({slug:x.departmentSlug,active:true,is_independent:false,human_only:false,director_agent_id:"director-"+x.code,mandate:mandates[x.departmentSlug]}));
const plan=()=>MATURITY_PROGRAMME_V1.map(x=>({departmentSlug:x.departmentSlug,missionTitle:x.code+" — "+x.label,objective:x.charter,tasks:[{title:x.code+" contrôles",description:x.requiredTerms.join(" et ")}]}));

test("detects the approved P0-P7 programme instruction",()=>{
 assert.equal(isMaturityProgrammeInstruction("Crée le Programme de fiabilisation et de maturité organisationnelle — AFE-CI V1"),true);
 assert.equal(isMaturityProgrammeInstruction("Fais un diagnostic ponctuel"),false);
});

test("accepts exactly the canonical eight workstreams and department mapping",()=>{
 assert.doesNotThrow(()=>assertCanonicalMaturityPlan(plan(),departments));
});

test("rejects a missing P-code before any mission creation",()=>{
 assert.throws(()=>assertCanonicalMaturityPlan(plan().filter(x=>!x.missionTitle.startsWith("P4")),departments),/P4/);
});

test("rejects reassignment of a canonical workstream to another directorate",()=>{
 const wrong=plan();wrong[0].departmentSlug="documentation-reporting";
 assert.throws(()=>assertCanonicalMaturityPlan(wrong,departments),/P0 doit relever/);
});

test("rejects semantically incomplete workstream content",()=>{
 const bad=plan();bad[2].objective="Plan général d'amélioration";bad[2].tasks=[{title:"Divers",description:"Travaux divers"}];
 assert.throws(()=>assertCanonicalMaturityPlan(bad,departments),/contenu incompatible/);
});

test("rejects a department whose actual mandate does not cover the canonical workstream",()=>{
 const incompatible=departments.map(x=>x.slug==="evidence-intelligence"?{...x,mandate:"Mandat général sans attribution de preuves ni provenance."}:x);
 assert.throws(()=>assertCanonicalMaturityPlan(plan(),incompatible),/mandat de direction incompatible/);
});

test("rejects unavailable, independent or directorless departments",()=>{
 const unavailable=departments.map(x=>x.slug==="infrastructure-securite"?{...x,active:false}:x);
 assert.throws(()=>assertCanonicalMaturityPlan(plan(),unavailable),/Direction\/mandat indisponible/);
});

test("canonicalizes mission titles and preserves the approved charter",()=>{
 const result=canonicalizeMaturityPlan(plan());
 assert.equal(result.length,8);
 assert.equal(result[0].missionTitle,"P0 — Intégrité des données et fiabilité du système");
 assert.match(result[0].objective,/contrôles d'intégrité/);
});
