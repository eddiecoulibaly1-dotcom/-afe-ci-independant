# AFE-CI Debate Engine — revue de finalisation V2.1

Date de revue : 2026-11-04  
Branche de travail : `audit/hardening-v2-finalization`  
Branche source : `feature/debate-engine-v2-1`  
Référence de comparaison V1.0.7 : `6c7f5142f1ecfed11944a232e08637f67bfa249d`

## 1. Périmètre et sécurité

Cette revue est réalisée sur une branche isolée créée depuis `feature/debate-engine-v2-1`. Les branches `main`, `feature/debate-engine-v2-1` et `baseline/v1.0.7` n'ont pas été déplacées. Aucune migration Supabase n'a été appliquée et aucun déploiement Production n'a été déclenché. L'intégration Vercel a automatiquement créé des déploiements Preview pour les commits de cette branche ; ils ne constituent pas une promotion Production.

La comparaison de la branche V2 avec le candidat V1.0.7 représente 179 commits et 67 chemins affectés : 51 ajouts, 15 modifications et 1 suppression. Les statistiques de diff indiquent environ 5 898 lignes ajoutées/supprimées. Ce chiffre décrit le diff Git, pas un volume de code entièrement réécrit.

## 2. Décisions de conservation

### Noyau stratégique à conserver

Ces éléments forment le noyau décisionnel et ne doivent pas être supprimés ni couplés au module marché :

- `src/engine.ts` — orchestration Architecte / Red Team / Arbitre, convergence et décision finale.
- `src/evidence.ts` — audit des affirmations et des preuves.
- `src/prompts.ts` — instructions des agents.
- `src/scoring.ts` — calcul des scores.
- `src/schema.ts` et `src/types.ts` — contrat de données.
- `src/auth.ts` — authentification serveur par jeton Supabase.
- `src/supabase-store.ts`, `src/store.ts`, `src/workspace-store.ts`, `src/v1-store.ts` — persistance, espaces de travail, partage et audit.
- `src/lab-v106.ts` — interface/laboratoire existant.
- Les tests du noyau, les migrations du noyau Debate Engine et la documentation d'architecture.

### Extensions décisionnelles à conserver comme modules du noyau

- `agent-registry.ts`, `arbitration.ts`, `audit-engine.ts`, `decision-intelligence.ts`, `decision-router.ts`, `quantitative-reasoning.ts`, `report-engine.ts`, `risk-engine.ts`, `scenario-engine.ts`.

Ces modules apportent des capacités de raisonnement, de risque, de scénario et de restitution. Ils doivent rester indépendants, typés et couverts par des tests ; leur présence ne doit pas transformer le moteur en un ensemble de règles métier propres à un seul secteur.

## 3. Éléments à renforcer — corrections effectuées dans cette branche

| Fichier | Constat | Action réalisée |
|---|---|---|
| `.github/workflows/debate-engine-ci.yml` | Une nouvelle exécution pouvait annuler une vérification en cours ; la branche d'audit n'était pas déclenchée. | Ajout du déclencheur sur la branche d'audit et désactivation de l'annulation des vérifications en cours. |
| `debate-engine/package.json` | Version package 1.1.1 alors que le serveur annonce 1.1.2. | Version alignée sur 1.1.2. |
| `debate-engine/package-lock.json` | Version racine du lockfile à aligner sur le manifeste. | Version du lockfile alignée sur 1.1.2. |
| `debate-engine/src/server.ts` | Les routes de renseignement de marché étaient exposées dans le même serveur que le noyau, même si les tables ne sont pas présentes en production. | Ajout d'un garde-fou : toutes les routes `/market-prices` répondent 404 tant que `MARKET_INTELLIGENCE_ENABLED=true` n'est pas explicitement défini. |
| `debate-engine/.env.example` | Absence d'un interrupteur explicite pour le sous-système marché. | Ajout de `MARKET_INTELLIGENCE_ENABLED=false` par défaut. |

Ces modifications sont limitées à la branche d'audit. Elles ne constituent pas une validation de production.

## 4. Sous-système à isoler

Le module Market Intelligence doit être un domaine optionnel distinct du noyau Debate Engine. Les fichiers concernés sont :

- Sources et règles : `src/market-intelligence.ts`, `src/market-intelligence-policy.ts`, `src/market-sources.ts`, `src/chick-market-catalog.ts`.
- Persistance dédiée : `src/market-price-store.ts`.
- Tests dédiés : `test/chick-market.test.ts`, `test/market-intelligence-policy.test.ts`, `test/market-intelligence.test.ts`, `test/market-ledger-migration.test.ts`, `test/market-sources.test.ts`.
- Migrations dédiées : les quatre migrations `20261102...market_price...` et `refresh_market_price_current_view`.
- Ressources : `templates/market-prices-template.csv`, `docs/market-partner-access.md`, `docs/market-price-security-review.md`, `docs/supabase-market-ledger-test-protocol.md`.

**Décision :** conserver ces fichiers, mais ne pas les considérer comme dépendances du noyau décisionnel. L'isolement d'exécution est renforcé par le feature flag serveur, désactivé par défaut. Les migrations marché ne doivent être exécutées que sur une base explicitement destinée à ce module. Aucun déplacement physique de fichiers n'est effectué dans cette passe, afin de ne pas casser les imports ni l'historique avant qu'un découpage de package puisse être testé par CI.

## 5. Migrations et état réel des bases

Les contrôles en lecture seule ont confirmé :

- `afe-ci-production` : tables `debates`, `debate_rounds`, `debate_events` et `debate_execution_steps` présentes ; tables `market_price_observations` et `market_price_import_batches` absentes.
- `afe-ci-test` : les tables du noyau et les deux tables de marché sont présentes.
- L'historique de migrations de test et de production n'est pas identique. Les versions et noms enregistrés ne correspondent pas toujours exactement aux noms des fichiers présents dans Git. Il faut donc comparer les définitions effectives, pas seulement les noms.
- Aucune migration n'a été appliquée pendant cette revue.

### Avis Supabase production

Les advisors en lecture seule ont signalé notamment :

- une table `public.match_semantic_dictionary` avec RLS activé sans politique ;
- des fonctions `SECURITY DEFINER` exécutables par `anon` et/ou `authenticated`, dont `submit_public_order` ;
- la protection contre les mots de passe compromis désactivée ;
- quatre paires d'index dupliqués sur `debate_events`, `debate_evidence`, `debate_share_links` et `debate_shares` ;
- plusieurs politiques permissives concurrentes, y compris sur `debates`.

Les quatre doublons d'index sont confirmés par introspection SQL : `debate_events_round_idx` / `idx_debate_events_round_id`, `debate_evidence_round_idx` / `idx_debate_evidence_round_id`, `debate_share_links_created_by_idx` / `idx_debate_share_links_created_by`, `debate_shares_shared_by_idx` / `idx_debate_shares_shared_by`. Les définitions sont identiques. Le projet de nettoyage doit conserver un index par paire, après vérification des dépendances et en tenant compte du fait que la base de test ne possède pas les mêmes noms canoniques.

Ces constats doivent être traités dans des migrations correctives séparées, avec vérification de l'usage et des autorisations. Aucun index ni aucune politique n'a été supprimé ou modifié ici.

## 6. Divergence Git avec main

Au moment du contrôle, `main` et `feature/debate-engine-v2-1` étaient divergentes : la branche V2 avait 175 commits d'avance et 6 commits d'ascendance manquants. Les six changements repérés concernent l'orchestration durable, le schéma strict des propositions, la stratégie de reprise des fournisseurs, la limite de tentatives et les tests de compatibilité.

Le contenu de plusieurs fichiers critiques de la branche de travail correspond déjà à des changements observés dans `main` (notamment le code de fournisseurs et les contraintes de schéma), mais une équivalence complète de l'arbre n'a pas été démontrée. Ne pas fusionner les branches sur la seule base des messages de commits. Une comparaison de contenu ciblée des six changements doit précéder toute réconciliation d'historique.

## 7. Fichiers modifiés/ajoutés à conserver sous surveillance

- `src/providers.ts` : chaîne de secours multi-fournisseurs et délais ; surveiller coût cumulé, latence, erreurs d'authentification et modèles réellement disponibles.
- `src/server.ts` : routes API et orchestration durable ; maintenir les routes marché sous feature flag et couvrir les codes HTTP.
- `src/supabase-store.ts` : écritures multi-tables et journal ; tester les reprises, doublons et permissions RLS.
- `src/engine.ts` : règles de convergence et arbitrage quantitatif ; préserver les cas sans données suffisantes.
- `src/auth.ts` : conserver la clé publique uniquement pour la vérification du jeton ; les clés secrètes restent strictement côté serveur.
- `src/schema.ts` : maintenir l'égalité récursive entre propriétés déclarées et champs requis pour les schémas stricts.

## 8. Vérifications exécutées et points restant à clôturer

La CI GitHub Actions a exécuté `npm ci`, `npm run typecheck` et `npm test` sur le commit `b2fba4038d8347422c9dc707bea84e938fb00410` : installation réussie, TypeScript réussi, 56 tests réussis, 0 échec. Le premier passage avait révélé le défaut de détection des intentions financières ; le correctif a été intégré puis confirmé par le second passage.

Restent obligatoires avant fusion :

1. Revue détaillée des politiques RLS et fonctions RPC réellement présentes dans les deux bases.
2. Réconciliation contrôlée des six commits d'ascendance absents de la branche V2 (sans fusion automatique tant que l'équivalence de contenu n'est pas démontrée).
3. Vérification de la version `/health` sur le Preview ; les statuts Vercel de déploiement Preview sont distincts de la validation CI.
4. Validation humaine avant toute fusion vers `main`, migration ou promotion Production.

## 9. Interdictions de cette passe

- Ne pas déplacer ni réécrire `baseline/v1.0.7`.
- Ne pas fusionner dans `main`.
- Ne pas exécuter de migration sur Production.
- Ne pas promouvoir de déploiement Vercel.
- Ne pas supprimer les modules marché : ils sont isolés, pas abandonnés.
