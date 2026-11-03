# Revue de validation du Blueprint V2 et plan d'implémentation fichier par fichier

> Version 1.0.0 — 3 novembre 2026  
> Statut : revue technique effectuée, validation conditionnelle  
> Branche de travail : `feature/debate-engine-v2-1`  
> Production : `main` — aucune promotion autorisée

## 1. Décision de revue

**Avis : APPROUVABLE SOUS RÉSERVES, pour servir de cadre directeur de conception. Pas encore approuvé comme autorisation de développement fonctionnel ou de migration.**

Le Blueprint est cohérent sur son principe central : AFE-CI doit être une infrastructure de qualité décisionnelle et de gouvernance, pas une collection croissante d'agents. Les capacités Evidence, Falsification, Simulation, Human Governance et Outcome Learning sont correctement séparées comme responsabilités.

Les réserves sont les suivantes :
1. préciser le périmètre V1.0.7 exact et ses invariants ;
2. traiter l'orchestrateur durable V2.1 et les migrations déjà ajoutées comme un état existant à auditer, non comme une base réputée stable ;
3. faire de la vérification des preuves un processus distinct de la simple génération de références ;
4. séparer statut de décision, statut de preuve et approbation humaine ;
5. établir des jeux d'évaluation et des baselines avant d'adopter les KPI chiffrés ;
6. confirmer la protection des branches et les droits administratifs ;
7. identifier exactement Agora avant tout benchmark comparatif final.

Le Blueprint ne doit pas être étiqueté « approved final » tant que ces points ne sont pas traités. Cette revue valide la direction et le séquencement, pas les pondérations de scoring, les durées de conservation ni les contrats API finaux.

## 2. Baseline V1.0.7 retrouvée

L'historique Git permet maintenant d'identifier un commit qui porte explicitement le changement de version package à 1.0.7 :

- Commit de référence candidate : `8b542f5ea3db0d505ec25ec8972740d9b634bfb7`
- Message : `chore(debate-engine): bump package to V1.0.7`
- `debate-engine/package.json` à ce commit : version `1.0.7`
- Blob package : `0830aea80c6616d51a79a148a29838ef83686c90`
- `debate-engine/src/server.ts` à ce commit : constante VERSION `1.0.6`
- Le README de ce commit documente notamment V1.0.6 comme fondation collaborative.

**Conclusion :** ce commit est la meilleure baseline Git disponible, mais la version produit déclarée par le package et la version runtime ne concordent pas. La baseline doit donc être nommée « commit package V1.0.7 / runtime déclaré 1.0.6 » tant qu'une preuve supplémentaire ne résout pas l'écart. Ne pas inventer un tag : les références `v1.0.7` et `1.0.7` n'ont pas été trouvées.

Le commit V1.0.7 est ancêtre direct de `main). La comparaison Git indique que `main` a 13 commits d'avance sur ce commit, sans divergence dans la comparaison effectuée.

## 3. État actuel du dépôt et risques constatés

### 3.1 Branches

Branches visibles :
- `main` : commit `15e1e6b9bf31e5b2149ff490dbd63c9494cacd25`
- `feature/debate-engine-v2-1` : commit Blueprint `ea2ce60fefcfaeda5237ad878394404a4daa1ccd`

GitHub signale les deux branches comme `protected: false`. Ce constat doit être corrigé par un administrateur du dépôt si les permissions du connecteur ne permettent pas de le faire. Au minimum, exiger PR, checks obligatoires et interdiction de force-push sur `main).

### 3.2 CI

Run du commit Blueprint :
- Workflow : AFE-CI Debate Engine CI
- Run : 41742755211
- Job : Typecheck and tests
- TypeScript typecheck : réussi
- Unit and integration tests : échec
- Conclusion du run : `failure`

Le Blueprint est documentaire, mais le pipeline exécute aussi les tests de code du commit. Il est donc impossible de déclarer la branche saine. Il faut récupérer le détail des tests échoués et les corriger avant de prendre cette branche comme base d'implémentation. Aucun test n'est réputé réussi sur la seule base du typecheck.

### 3.3 Écart de versions sur main

Éléments observés :
- package.json : `1.1.1`
- server.ts : `1.1.2`
- README : sections produit V1.0.8 et V1.0.6.

Cette divergence doit être résolue dans le plan de release management, sans faire un bump de version opportuniste pendant la baseline.

### 3.4 Écart de périmètre important

La comparaison V1.0.7 → main montre 13 commits et de nombreux changements, dont :
- moteur de marché et ledger de prix ;
- nouvelles migrations de sécurité, de prix et de catalogue de poussins ;
- intelligence de décision et raisonnement quantitatif ;
- durcissement providers et API ;
- migrations de schéma du Debate Engine ;
- exécution durable, leases, retries et récupération des étapes ;
- tests d'orchestration et de raisonnement.

Ces éléments font désormais partie du chemin d'évolution de main et ne doivent pas être confondus avec les dix piliers V2. Ils nécessitent leur propre non-régression.

## 4. Principes de protection de la baseline

1. Ne jamais développer directement sur `main`.
2. Ne jamais réécrire l'historique de `main` ou de la baseline.
3. Créer une branche de référence dédiée depuis le commit V1.0.7 candidat.
4. Conserver un snapshot du code, du schéma SQL, des migrations et des contrats API.
5. Ne jamais modifier une migration déjà appliquée.
6. Faire toute évolution DB via une migration additive et testée sur une base jetable.
7. Tester V1.0.7 et main séparément : les deux sont des références différentes.
8. Les nouvelles fonctions V2 sont derrière feature flags serveur.
9. Pas de secret réel dans les tests, fixtures, logs ou documentation.
10. Pas de déploiement, de migration distante, de fusion ou de promotion de version dans cette phase.

## 5. Plan d'implémentation fichier par fichier

Le plan ci-dessous est ordonné par dépendance. Les chemins sont les chemins cibles ; un fichier déjà existant doit être audité et étendu, pas remplacé aveuglément. Les éléments V2 sont reportés jusqu'à la fin de la baseline.

### Phase 0 — Protection et inventaire (aucune modification du moteur)

| Fichier / chemin | Action | Détail / livrable | Validation |
|---|---|---|---|
| `.github/CONTRIBUTING.md` | À créer si absent | Politique PR, branches, tests, migrations, secrets, rollback | Revue mainteneur |
| `.github/PULL_REQUEST_TEMPLATE.md` | À créer si absent | Checklist non-régression, migration, sécurité, coût, rollback | Template visible |
| `.github/workflows/debate-engine-ci.yml` | Auditer | Node 24, install reproductible, typecheck, tests, sécurité, aucun secret requis | CI verte sur branche dédiée |
| `debate-engine/package.json` | Geler baseline | Scripts de test manquants à V1.0.7, versions exactes | Lockfile cohérent |
| `debate-engine/package-lock.json` | Geler baseline | Intégrité reproductible, aucune mise à jour de dépendance | npm ci |
| `debate-engine/.env.example` | Auditer | Variables documentées, noms et valeurs factices uniquement | Scan secrets |
| `debate-engine/docs/BASELINE_V1_0_7.md` | À créer | Commit, hashes, versions divergentes, limites et commandes de reproduction | Audit croisé |
| `debate-engine/docs/BASELINE_FILE_INVENTORY.md` | À créer | Inventaire complet fichiers source, tests, migrations et UI | Aucun chemin critique omis |

**Porte P0 :** baseline Git identifiée, copie de référence conservée, branches protégées ou procédure compensatoire approuvée. Aucun code métier modifié.

### Phase 1 — Reproductibilité et non-régression V1.0.7

| Fichier | Action prévue | Tests / précautions |
|---|---|---|
| `src/types.ts` | Documenter les contrats V1 et types persistés | Fixtures de compatibilité |
| `src/schema.ts` | Capturer les schémas structurés V1 | Cas JSON valides et invalides |
| `src/prompts.ts` | Archiver les prompts de référence | Tests snapshots, ne pas retoucher les formulations |
| `src/providers.ts` | Tests fournisseurs mockés, timeouts et erreurs | Aucun appel payant dans CI |
| `src/engine.ts` | Tests de comportement V1 | Convergence, unresolved, provisional, reprise |
| `src/scoring.ts` | Capturer les résultats de référence | Cas limites et déterminisme |
| `src/evidence.ts` | Tester classification et audit claims | Ne pas confondre evidence refs et vérification externe |
| `src/store.ts` | Tester persistance fichier / Supabase | Round-trip et isolation utilisateur |
| `src/supabase-store.ts` | Tests d'intégration isolés | Auth, RLS, retries, leases, idempotence |
| `src/auth.ts` | Tests d'authentification | Token absent, invalide, expiré |
| `src/workspace-store.ts` | Tests d'accès et partage | Deux workspaces et deux utilisateurs |
| `src/v1-store.ts` | Tests notifications, audit, liens | Expiration, révocation, hash token |
| `src/server.ts` | Tests API de contrat | Codes HTTP, erreurs, routes publiques/protégées |
| `src/lab-v09.ts`, `src/lab-v106.ts` | Capturer les parcours UI | Tests smoke navigateur ou tests DOM adaptés |
| `test/*.test.ts` | Ajouter les tests manquants | Aucune dépendance à une clé réelle |

**Porte P1 :** tous les parcours V1.0.7 de référence sont reproductibles, puis les régressions introduites jusqu'à main sont mesurées séparément.

### Phase 2 — Stabilisation de la branche Preview actuelle

| Fichier | Action prévue | Motif |
|---|---|---|
| `src/server.ts` | Revue configuration modèle/version et routes | Cohérence package/runtime/provider |
| `src/providers.ts` | Revue fallback, timeouts, schema strict | Résilience sans masquer les erreurs |
| `src/schema.ts` | Compatibilité schéma strict OpenAI/Gemini | Tests de contrat |
| `src/engine.ts` | Vérifier orchestration et convergence | Pas de régression décisionnelle |
| `src/supabase-store.ts` | Vérifier claims, lease, retries, idempotence | Reprise sans doublon |
| `supabase/migrations/20261103141000_afe_ci_debate_engine_core_schema_v1.sql` | Revue SQL/RLS | Aucune application ou modification ici |
| `supabase/migrations/20261103141050_afe_ci_debate_workspace_fk.sql` | Revue FK | Intégrité référentielle |
| `supabase/migrations/20261103141100_afe_ci_debate_rls_outer_reference_hardening.sql` | Revue politiques | Isolation multi-tenant |
| `supabase/migrations/20261103141200_afe_ci_debate_foreign_key_indexes.sql` | Revue index | Performance |
| `supabase/migrations/20261103141300_afe_ci_debate_child_read_rls_policies.sql` | Revue RLS enfants | Aucun accès transversal |
| `supabase/migrations/20261103141400_afe_ci_debate_realtime_publication.sql` | Revue publication | Realtime ne remplace pas la source durable |
| `supabase/migrations/20261103143000_afe_ci_debate_allow_provisional_status.sql` | Revue statuts | Compatibilité clients |
| `supabase/migrations/20261103144000_afe_ci_debate_execution_steps.sql` | Revue table et fonctions | Idempotence et atomicité |
| `supabase/migrations/20261103144100_afe_ci_debate_execution_steps_service_role_policy.sql` | Revue accès service | Privilèges minimaux |
| `supabase/migrations/20261103210000_afe_ci_debate_execution_step_retry_hardening.sql` | Revue retry | Pas de retry infini |
| `supabase/migrations/20261103231000_afe_ci_debate_execution_step_recovery_limit.sql` | Revue plafond | Reprise contrôlée |
| `test/orchestration.test.ts` | Corriger / compléter | Reprise, doublons, crash, lease expiré |
| `test/providers.test.ts` (si absent) | À créer | Erreurs API, timeouts, JSON strict, fallback |
| `test/schema-compatibility.test.ts` (si absent) | À créer | Schémas fournisseurs et champs requis |

Ne pas supposer que les migrations listées ont été appliquées en production. Vérifier l'historique Supabase dans l'environnement autorisé avant toute décision opérationnelle.

**Porte P2 :** CI entièrement verte, test E2E de débat exécuté en environnement Preview isolé, données persistées et vérifiées.

### Phase 3 — Contrats d'architecture V2, sans nouvelle logique métier

| Fichier | Action prévue | Contenu |
|---|---|---|
| `src/contracts/decision-case.ts` | À créer | Agrégat Decision Case versionné |
| `src/contracts/evidence.ts` | À créer | Claim, Evidence, Source, Check, Relation |
| `src/contracts/scenario.ts` | À créer | Hypothèses, drivers, horizons, signaux |
| `src/contracts/governance.ts` | À créer | Intervention, approbation, transition |
| `src/contracts/outcome.ts` | À créer | KPI prévu, résultat observé, source |
| `src/contracts/index.ts` | À créer | Exports publics versionnés |
| `src/compat/v1-debate-adapter.ts` | À créer | Adaptation V1 vers Decision Case |
| `test/contracts/*.test.ts` | À créer | Validation, sérialisation, compatibilité |

Aucun endpoint nouveau ne doit être exposé avant validation des contrats et de l'adaptateur.

### Phase 4 — Evidence Intelligence et falsification

| Fichier | Action prévue | Contenu |
|---|---|---|
| `src/evidence/claim-extractor.ts` | À créer / fusionner avec evidence.ts | Claims atomiques |
| `src/evidence/source-registry.ts` | À créer | Provenance et métadonnées sources |
| `src/evidence/verification.ts` | À créer | Vérification réelle, statut et limites |
| `src/evidence/graph.ts` | À créer | Relations et snapshots |
| `src/falsification/plan.ts` | À créer | Hypothèses réfutables et tests |
| `src/falsification/runner.ts` | À créer | Exécution contrôlée de recherches/tests |
| `src/falsification/evaluator.ts` | À créer | Résultat et degré de réfutation |
| `test/evidence/*.test.ts` | À créer | Provenance, contradiction, sources périmées |
| `test/falsification/*.test.ts` | À créer | Fausse conclusion, contre-exemple, test non concluant |

### Phase 5 — Simulation, gouvernance et suivi

| Fichier | Action prévue | Contenu |
|---|---|---|
| `src/simulation/scenario-builder.ts` | À créer | Scénarios qualitatifs et quantitatifs |
| `src/simulation/sensitivity.ts` | À créer | Sensibilité des résultats aux hypothèses |
| `src/governance/transition-guard.ts` | À créer | Machine d'état et règles d'approbation |
| `src/governance/interventions.ts` | À créer | Suspension, reprise, clarification |
| `src/outcomes/metrics.ts` | À créer | Mesures prévues / observées |
| `src/outcomes/follow-up.ts` | À créer | Échéances et suivi |
| `src/audit/append-only.ts` | À créer ou fusionner avec audit existant | Journal métier immuable |
| `test/governance/*.test.ts` | À créer | Permissions et transitions interdites |
| `test/outcomes/*.test.ts` | À créer | Donnée manquante, valeur nulle, résultat retardé |

### Phase 6 — Mémoire et modules de domaine

| Fichier | Action prévue | Contenu |
|---|---|---|
| `src/memory/lesson.ts` | À créer | Leçon sourcée et validée |
| `src/memory/retrieval.ts` | À créer | Recherche limitée au workspace |
| `src/memory/retention.ts` | À créer | Rétention, archivage, suppression |
| `src/domains/manifest.ts` | À créer | Contrat des modules |
| `src/domains/finance/` | Différé | Module pilote seulement après choix du domaine |
| `src/domains/agriculture/` | Différé | Module pilote seulement après choix du domaine |
| `test/memory/*.test.ts` | À créer | Isolation et validation des leçons |
| `test/domains/*.test.ts` | À créer | Jeux de tests par domaine |

### Phase 7 — Interface et exposition API

| Fichier | Action prévue | Contenu |
|---|---|---|
| `src/server.ts` | Étendre par routeur dédié | Routes Decision Case compatibles |
| `src/routes/decision-cases.ts` | À créer | CRUD et exécution |
| `src/routes/evidence.ts` | À créer | Lecture et vérification des preuves |
| `src/routes/governance.ts` | À créer | Interventions et approbations |
| `src/routes/outcomes.ts` | À créer | Résultats et suivi |
| `src/lab-v2.ts` | À créer | UI V2 derrière feature flag |
| `src/feature-flags.ts` | À créer | Flags côté serveur par workspace |
| `test/api/*.test.ts` | À créer | Contrats HTTP, auth, RLS et flags |

## 6. Évaluation des composants V2 déjà présents

Ces fichiers ne sont ni adoptés ni supprimés par principe. Leur statut initial est « à auditer ».

| Fichier existant | Décision préliminaire | Justification |
|---|---|---|
| `src/decision-router.ts` | À comparer au Decision Case Orchestrator | Risque de duplication de routage |
| `src/agent-registry.ts` | Revoir comme registre de capacités, pas d'agents obligatoires | Architecture par capacités |
| `src/scenario-engine.ts` | Candidat à conserver après alignement du contrat Scenario | Responsabilité cible claire |
| `src/risk-engine.ts` | À fusionner éventuellement avec risk/falsification/domain | Éviter double scoring |
| `src/arbitration.ts` | À comparer au juge et à la gouvernance | Ne pas créer deux autorités finales |
| `src/report-engine.ts` | Candidat à conserver comme projection de rapport | Ne doit pas devenir source de vérité |
| `src/audit-engine.ts` | À comparer au journal existant | Préserver append-only et éviter double audit |
| `test/unified-architecture.test.ts` | Revoir et garder les tests pertinents | Les tests doivent valider les contrats adoptés |
| `docs/UNIFIED_ARCHITECTURE_AUDIT.md` | Archiver comme historique ou fusionner | Éviter deux documents de référence concurrents |

Aucun fichier de cette liste ne sera supprimé avant revue de ses imports, tests, références et dépendances.

## 7. Plan de protection GitHub

Les branches visibles sont signalées non protégées. Actions administratives à réaliser :
- activer la protection de `main` ;
- exiger une pull request ;
- exiger le workflow `AFE-CI Debate Engine CI` réussi ;
- interdire force-push et suppression de `main` ;
- exiger résolution des conversations de revue ;
- exiger au moins une approbation si le mode de collaboration le permet ;
- envisager une protection équivalente pour la branche Preview ;
- réserver les droits d'administration aux personnes responsables.

Si la protection ne peut être configurée via les permissions disponibles, documenter ce blocage et ne pas prétendre que les branches sont protégées.

## 8. Critères d'acceptation de la baseline

La baseline V1.0.7 sera considérée reproduite uniquement lorsque :
- le commit et les blobs de référence sont archivés ;
- les versions package/runtime divergentes sont documentées ;
- les dépendances s'installent avec `npm ci` ;
- typecheck passe ;
- un jeu de tests de non-régression passe ;
- un test de débat complet avec fournisseurs mockés passe ;
- un test d'intégration Supabase isolé passe ;
- les migrations et RLS sont testées sur une base de test ;
- les parcours UI/API essentiels sont vérifiés ;
- les résultats et logs non sensibles sont archivés.

La baseline main est une seconde référence : elle doit avoir ses propres résultats et ne pas être confondue avec V1.0.7.

## 9. Ordre d'exécution et interdictions

Ordre obligatoire : P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7.

Interdictions jusqu'à validation explicite :
- pas de modification de `main` ;
- pas de migration Supabase distante ;
- pas de déploiement Vercel ;
- pas de fusion ;
- pas de suppression des composants V2 existants ;
- pas de refonte du moteur V1 ;
- pas de nouveau domaine spécialisé ;
- pas de réglage de pondérations sur intuition ;
- pas d'affirmation « V2 fonctionnelle » sans test E2E complet.

## 10. Décisions requises du propriétaire produit

1. Confirmer que le commit `8b542f5ea3db0d505ec25ec8972740d9b634bfb7` est la référence historique voulue pour V1.0.7, malgré la constante runtime 1.0.6.
2. Confirmer le domaine pilote V2 après la baseline.
3. Fournir l'identité exacte d'Agora (URL/éditeur) pour le benchmark.
4. Confirmer les niveaux de risque nécessitant une double approbation.
5. Confirmer les règles de rétention et de confidentialité par workspace.

**État final de la revue :** direction stratégique validée sous réserves ; plan de migration défini ; baseline V1.0.7 identifiée comme candidate solide ; tests Preview actuellement rouges ; production et main restent hors intervention.
