import test from "node:test";
import assert from "node:assert/strict";
import {
  advancePhase, authorizeAction, createProject, deliveryReadiness,
  recordApproval, recordEvidence, validateBrief
} from "../src/autonomous-development.js";
import type { ProjectBrief } from "../src/autonomous-development.js";

const brief: ProjectBrief = {
  name: "Application de démonstration",
  objective: "Construire une application de démonstration vérifiable.",
  targetUsers: ["équipe produit"],
  constraints: ["aucune modification de production"],
  requirements: [{
    id: "REQ-001",
    statement: "L'application doit présenter un résultat.",
    priority: "must",
    acceptanceCriteria: ["Le résultat est visible après exécution."],
    source: "user"
  }],
  nonGoals: ["Déploiement en production"]
};

test("rejects a mandatory requirement without acceptance criteria", () => {
  assert.throws(() => validateBrief({
    ...brief,
    requirements: [{ ...brief.requirements[0], acceptanceCriteria: [] }]
  }), /critère d'acceptation/);
});

test("allows reversible development actions without approval", () => {
  assert.equal(authorizeAction("development_branch", [], "feature/test").outcome, "allowed");
  assert.equal(authorizeAction("test_deployment", [], "preview").outcome, "allowed");
});

test("requires scoped approval for production and irreversible actions", () => {
  const denied = authorizeAction("production_deployment", [], "app-prod");
  assert.equal(denied.outcome, "approval_required");
  if (denied.outcome !== "approval_required") return;
  const project = recordApproval(createProject(brief), "production_deployment", "app-prod", true);
  assert.equal(authorizeAction("production_deployment", project.approvals, "app-prod").outcome, "allowed");
  assert.equal(authorizeAction("production_deployment", project.approvals, "other-prod").outcome, "approval_required");
});

test("prevents skipping phases and requires execution evidence before verification", () => {
  let project = createProject(brief);
  assert.throws(() => advancePhase(project, "architecture"), /Transition de phase invalide/);
  project = advancePhase(project, "discovery");
  project = advancePhase(project, "specification");
  project = advancePhase(project, "architecture");
  project = advancePhase(project, "implementation");
  assert.throws(() => advancePhase(project, "verification"), /preuve d'exécution/);
  project = recordEvidence(project, {
    artifact: "src/app.ts",
    state: "executed",
    description: "Implémentation exécutée."
  });
  assert.equal(advancePhase(project, "verification").phase, "verification");
});

test("verified evidence requires proof and delivery requires tests and documentation", () => {
  let project = createProject(brief);
  assert.throws(() => recordEvidence(project, {
    artifact: "test-results",
    state: "verified",
    description: "Tests exécutés."
  }), /preuve vérifiable/);
  project = recordEvidence(project, {
    artifact: "test-results",
    state: "verified",
    description: "Suite de tests exécutée avec succès.",
    proof: "CI run #123: success"
  });
  assert.equal(deliveryReadiness(project).ready, false);
  project = recordEvidence(project, {
    artifact: "README",
    state: "verified",
    description: "Documentation de livraison.",
    proof: "Fichier README relu et validé."
  });
  assert.equal(deliveryReadiness(project).ready, true);
  project = advancePhase(project, "discovery");
  project = advancePhase(project, "specification");
  project = advancePhase(project, "architecture");
  project = advancePhase(project, "implementation");
  project = advancePhase(project, "verification");
  project = advancePhase(project, "staging");
  assert.equal(advancePhase(project, "delivery").phase, "delivery");
});
