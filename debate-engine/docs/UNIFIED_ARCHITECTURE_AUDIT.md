# Audit technique — Unified Debate & Decision Intelligence

Date de l'audit : 2026-11-03  
Branche examinée : `feature/debate-engine-v2-1`

## État constaté

Le dépôt possède déjà un noyau de débat à trois rôles (Architect, Red Team, Judge), une orchestration persistante par étapes, un audit déterministe des références, un score pondéré, un raisonnement quantitatif et une couche Supabase.

La fonction `decision-intelligence.ts` existe déjà mais ses primitives ne sont pas encore utilisées par le routeur HTTP ni par le cycle principal d'orchestration. La configuration du serveur avait un modèle Gemini par défaut différent de celui du fournisseur ; elle a été alignée sur `GEMINI_MODEL` puis `gemini-3.8-flash`.

## Extensions ajoutées

- `decision-router.ts` : qualification déterministe et sélection de mode (débat, décision, hybride).
- `agent-registry.ts` : registre des capacités et activation conditionnelle des agents.
- `scenario-engine.ts` : scénarios qualitatifs sans prévisions chiffrées inventées.
- `risk-engine.ts` : cotation déterministe probabilité × impact.
- `arbitration.ts` : garde-fous de recommandation et verdict indéterminé en cas de preuves insuffisantes.
- `report-engine.ts` : contrat de rapport structuré et statut provisoire.
- `audit-engine.ts` : événements de traçabilité et contrôle des identifiants.
- `test/unified-architecture.test.ts` : tests unitaires de ces composants.

## Risques et travaux restant à traiter

1. L'audit des références actuel considère une affirmation comme « supported » dès qu'une référence est fournie, alors que le commentaire précise que la vérification externe reste distincte. Il faut introduire un état explicite « unverified » et une vraie vérification de source avant toute confirmation.
2. Le routeur et les nouveaux moteurs sont des primitives de domaine ; ils ne sont pas encore branchés dans `server.ts`, l'interface ou la persistance.
3. Le modèle SQL initial autorise les modes `exploration`, `decision`, `validation`, alors que la cible produit utilise `debate`, `decision`, `hybrid`. Une migration additive et une adaptation du champ `mode` sont nécessaires avant d'activer le routage en production.
4. Le schéma SQL historique du statut a été corrigé par une migration ultérieure pour accepter `provisional`. Les migrations doivent rester séquentielles ; ne pas modifier rétroactivement les migrations déjà appliquées.
5. Les tables `claims`, `evidence_sources`, `evidence_checks`, `decision_cases`, `decision_options`, `decision_scenarios`, `decision_risks`, `arbitration_results`, `decision_reports` et `audit_events` n'existent pas sous ces noms dans le modèle actuel. Les tables `debate_events`, `debate_hypotheses`, `debate_evidence`, `debate_decisions` et `admin_audit_log` couvrent déjà une partie des besoins ; toute extension doit éviter les doublons.
6. Les tests unitaires ne remplacent pas un test de bout en bout avec fournisseurs IA, Supabase et interface.

## Règle de livraison

Ces extensions sont ajoutées sur la branche Preview uniquement. Ne pas promouvoir en production avant typecheck, suite complète de tests, revue des migrations et test fonctionnel de bout en bout.
