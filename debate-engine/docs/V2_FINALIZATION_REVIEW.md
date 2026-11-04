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

L'introspection des politiques confirme aussi un écart entre environnements : en production, `debates_select_access` et `debates_select_v09_access` ont des prédicats identiques ; `debates_update_access` et `debates_update_v09_access` ont également des prédicats identiques. La base de test ne présente pas ces doublons. La correction de production peut retirer uniquement les deux politiques `*_v09_*` après validation des dépendances, sans modifier les politiques actives ; ne pas exécuter cette correction pendant la présente étape.

Ces constats doivent être traités dans des migrations correctives séparées, avec vérification de l'usage et des autorisations. Aucun index ni aucune politique n'a été supprimé ou modifié ici.

## 6. Réconciliation de contenu entre main et feature — vérification effectuée

La comparaison des arbres Git complets a été exécutée entre `main` (`15e1e6b...`) et `feature/debate-engine-v2-1` (`1a3dcba...`). Résultat :

- Arbre main : 85 fichiers suivis ; arbre feature : 96 fichiers suivis.
- Dans le périmètre `debate-engine/` et `.github/workflows/`, 88 chemins ont été comparés.
- 12 différences seulement : 11 fichiers propres à la branche V2 (modules de risque, arbitrage, scénarios, audit, reporting, routeur, registre d'agents et documents V2), plus un seul fichier différent déjà existant dans les deux branches : `debate-engine/src/server.ts`.
- Les 84 autres fichiers suivis par main sont strictement identiques (même empreinte Git blob) dans la branche feature.

Les six commits d'ascendance absents sont donc **déjà représentés dans le contenu de la branche V2** pour leurs changements utiles : CI, schéma JSON strict, retries multi-fournisseurs, reprise bornée des étapes, tests de compatibilité, migrations et documentation. Aucun cherry-pick de ces six commits n'est nécessaire ; il risquerait de réintroduire des versions anciennes ou des doublons.

Le seul fichier divergent est `server.ts`. La version V2 utilise `gemini-3.8-flash` comme modèle par défaut, cohérent avec `providers.ts`, tandis que la version main utilise encore `gemini-2.5-flash`. La version feature est donc retenue. La documentation officielle Google confirme que `gemini-3.8-flash` est un modèle stable et le modèle Flash recommandé actuellement. <https://ai.google.dev/gemini-api/docs/models>

**Décision : réconciliation du contenu validée ; réconciliation de l'historique Git non effectuée.** Les branches restent divergentes de 175 commits d'avance côté feature et 6 commits d'avance côté main. Une fusion de l'historique n'est pas requise pour récupérer les modifications, et ne doit pas être faite avant la revue des protections Git et la décision de stratégie de branche.

## 7. Fichiers modifiés/ajoutés à conserver sous surveillance

- `src/providers.ts` : chaîne de secours multi-fournisseurs et délais ; surveiller coût cumulé, latence, erreurs d'authentification et modèles réellement disponibles.
- `src/server.ts` : routes API et orchestration durable ; maintenir les routes marché sous feature flag et couvrir les codes HTTP.
- `src/supabase-store.ts` : écritures multi-tables et journal ; tester les reprises, doublons et permissions RLS.
- `src/engine.ts` : règles de convergence et arbitrage quantitatif ; préserver les cas sans données suffisantes.
- `src/auth.ts` : conserver la clé publique uniquement pour la vérification du jeton ; les clés secrètes restent strictement côté serveur.
- `src/schema.ts` : maintenir l'égalité récursive entre propriétés déclarées et champs requis pour les schémas stricts.


## 8. Réconciliation Supabase Test / Production — lecture seule

Les deux bases ont été interrogées directement en SQL, sans aucune écriture.

### 8.1 Schéma structurel

Les signatures normalisées des colonnes et des contraintes des tables `debate*` sont identiques entre Test et Production. La différence d'ordre des colonnes de `debates` n'est qu'une différence physique d'ordre, pas de définition. Les tables du noyau, y compris `debate_execution_steps`, ont les mêmes colonnes, types, nullabilités, valeurs par défaut et contraintes.

Conséquence : **ne pas rejouer la migration de création du schéma V1 sur Production**. Production possède déjà le schéma et une chaîne historique antérieure (`debate_engine_memory_v1`, `v08_debate_user_ownership`, `v1_0_6_debate_hardening`, etc.). Les journaux de migration ont des noms et des horodatages différents entre Test et Production ; ils ne doivent pas être rendus artificiellement identiques en insérant manuellement des lignes dans `schema_migrations`.

### 8.2 Index dupliqués en Production

Quatre index redondants existent uniquement en Production. Leurs définitions sont identiques aux index canoniques suivants :

| Index legacy à retirer | Index canonique à conserver |
|---|---|
| `debate_events_round_idx` | `idx_debate_events_round_id` |
| `debate_evidence_round_idx` | `idx_debate_evidence_round_id` |
| `debate_share_links_created_by_idx` | `idx_debate_share_links_created_by` |
| `debate_shares_shared_by_idx` | `idx_debate_shares_shared_by` |

Les statistiques PostgreSQL indiquent que les quatre index legacy ont zéro scan depuis la remise à zéro des statistiques ; l'index canonique des événements a été utilisé 18 fois. La migration préparée `20261104120000_afe_ci_debate_duplicate_policy_index_cleanup.sql` retire uniquement les index legacy, avec `IF EXISTS`, et est sans effet sur Test où ils n'existent pas.

### 8.3 Politiques RLS redondantes et dérive des rôles

Production possède deux politiques redondantes sur `debates` :

- `debates_select_v09_access`, identique à `debates_select_access` ;
- `debates_update_v09_access`, identique à `debates_update_access`.

Test ne possède que les politiques canoniques. La migration de nettoyage retire uniquement les deux doublons legacy.

Une différence fonctionnelle demeure sur `debate_workspace_members` :
- Production : politiques `admin_insert/update/delete`, permettant au propriétaire **ou à un membre owner/admin** de gérer les membres.
- Test : politiques `owner_insert/update/delete`, réservées au propriétaire du workspace.

Cette différence n'est pas automatiquement corrigée : elle touche à la délégation des droits d'administration. Elle doit être tranchée explicitement et les tests doivent refléter le comportement retenu.

### 8.4 Privilèges SQL et risque latent

Dans les privilèges de table observés :
- Production : les tables du noyau examinées sont accessibles en écriture/lecture via `service_role`, sans privilège direct `UPDATE` pour `authenticated`.
- Test : `authenticated` dispose notamment de `SELECT` sur `debates`, `debate_workspace_members` et `debate_shares`, mais pas de privilège `UPDATE` sur `debates`.

La politique `debates_update_access` a un `WITH CHECK` qui contient `workspace_id IS NULL`. Cette condition est plus permissive que le contrôle de ligne de `USING`. Elle n'est pas directement exploitable via un UPDATE PostgREST par `authenticated` tant que ce rôle ne reçoit pas le privilège SQL UPDATE ; elle constitue néanmoins un risque latent. **Ne pas accorder UPDATE à authenticated** avant de revoir cette politique et de protéger explicitement les champs de propriété (`user_id`, `workspace_id`).

La fonction trigger `handle_new_debate_profile` en `SECURITY DEFINER` n'est pas exécutable par `anon` ni `authenticated` dans les deux bases ; son exécution est limitée à `postgres`/`service_role`.

### 8.5 Historique des migrations et périmètre Market

Les deux environnements ont des journaux de migration différents, mais les signatures du schéma Debate Engine sont identiques. Test possède les migrations du registre de prix et les tables Market Intelligence ; Production ne possède pas ces tables. Le feature flag serveur reste donc désactivé par défaut. Ne pas appliquer les migrations marché en Production dans cette phase.

### 8.6 Migration corrective préparée, non exécutée

Le fichier `supabase/migrations/20261104120000_afe_ci_debate_duplicate_policy_index_cleanup.sql` a été ajouté à la branche d'audit. Il supprime seulement les deux politiques RLS en double et les quatre index legacy redondants. Il ne touche ni aux données, ni aux contraintes, ni aux index canoniques.

**Statut : migration préparée uniquement. Aucune migration n'a été exécutée sur Test ou Production.** Avant exécution, prévoir une fenêtre calme, sauvegarder l'état, contrôler le diff SQL et vérifier les résultats post-migration. Le `DROP INDEX` normal prend un verrou de table ; ce nettoyage ne doit pas être lancé pendant un pic d'activité.

## 9. Vérifications exécutées et points restant à clôturer

La CI GitHub Actions a exécuté `npm ci`, `npm run typecheck` et `npm test` sur le commit final `6db6c32201460918fbe5bbf534f76e6900a74933` : installation réussie, TypeScript réussi, **59 tests réussis, 0 échec**. Le premier test du nettoyage avait un comptage trop large ; la regex a été corrigée pour ne compter que les six instructions `DROP ... IF EXISTS` exécutables. Le passage suivant est vert.

Les six projets Vercel liés au dépôt ont tous produit un Preview `READY` pour ce commit. Le Preview principal `https://afe-ci-independant-c1iw6x1vi-eddiecoulibaly1-dotcom.vercel.app/health` répond HTTP 200 et annonce `version: 1.1.2`, `deployment: healthy`. Ce Preview n'a pas été promu en Production. Les logs de build contiennent des avertissements non bloquants concernant les scripts d'installation npm et les actions GitHub v4 ciblant Node 20 ; ils n'ont pas empêché la compilation ni les tests.

### Baseline V1.0.7

La branche historique `baseline/v1.0.7` reste intacte sur `8b542f5...`. Une nouvelle branche non destructive `baseline/v1.0.7-final` a été créée sur le candidat finalisé `6c7f5142f1ecfed11944a232e08637f67bfa249d`. Les deux branches restent séparées afin de préserver la traçabilité ; aucune n'a été déplacée.

### Protection Git

L'API GitHub confirme qu'aucun ruleset de dépôt n'est configuré (`rulesets=[]`) et que `main`, `feature/debate-engine-v2-1`, `baseline/v1.0.7`, `baseline/v1.0.7-final` et la branche d'audit sont toutes non protégées. La connexion GitHub disponible ne dispose pas des permissions d'administration nécessaires pour créer ces protections. Il faut donc activer dans GitHub les règles de protection : interdiction de suppression et de force-push pour les deux baselines ; PR obligatoire, contrôles CI requis et interdiction de force-push pour `main`. Aucune règle n'a été modifiée.

### Points restant avant fusion ou clôture complète

1. Décider si le rôle `admin` peut gérer les membres d'un workspace en production ; aligner ensuite les politiques et les tests de Test/Production sur cette règle métier.
2. Corriger la politique `debates_update_access` avant tout octroi futur du privilège SQL UPDATE à `authenticated` ; ce privilège n'est pas actuellement accordé.
3. Activer les protections Git via un compte disposant des permissions d'administration.
4. Décider de la stratégie d'historique Git (merge commit ou conservation des branches). Les six changements main sont déjà présents dans le contenu V2 ; aucun cherry-pick n'est requis.
5. Validation humaine avant toute fusion vers `main`, exécution de la migration corrective ou promotion Production.

## 10. Garde-fous de cette passe

- Ne pas déplacer ni réécrire `baseline/v1.0.7`.
- Ne pas fusionner dans `main`.
- Ne pas exécuter de migration sur Production.
- Ne pas promouvoir de déploiement Vercel.
- Ne pas supprimer les modules marché : ils sont isolés, pas abandonnés.

## 10. Réconciliation de contenu Git — résultat exhaustif

Une comparaison directe des arbres Git complets (85 blobs sur `main`, 96 sur `feature/debate-engine-v2-1`) confirme :

- Les 85 fichiers présents sur `main` existent aussi sur la branche V2.
- 84 de ces 85 fichiers ont exactement le même SHA de blob : leur contenu est identique octet pour octet.
- Le seul fichier divergent parmi les fichiers communs est `debate-engine/src/server.ts`.
- La branche V2 contient 11 fichiers supplémentaires : trois documents Blueprint/audit, sept modules décisionnels supplémentaires et `test/unified-architecture.test.ts`.
- Aucun fichier présent sur `main` n'est absent de la branche V2.

Cela explique la divergence de 175 commits d'avance / 6 commits en retard : elle est principalement une divergence d'ascendance Git, et non une perte des changements fonctionnels. Les changements de schéma strict, les retries fournisseurs, la migration de reprise bornée et le test de compatibilité strict sont déjà présents à l'identique dans les deux arbres.

### Décision de réconciliation

Ne pas cherry-pick ni fusionner les six commits de `main` en bloc : cela risquerait de rejouer des modifications déjà présentes et de créer des conflits inutiles. Conserver le `server.ts` de la branche V2, car son défaut Gemini `3.8-flash` est cohérent avec le défaut de `providers.ts` ; la version `main` utilise `2.5-flash` dans ce seul point, créant une incohérence avec le fournisseur. Cette différence est intentionnelle et doit rester couverte par un test de configuration.

**Conclusion :** réconciliation de contenu validée en lecture seule. La divergence d'historique ne nécessite pas de fusion de code à ce stade. La prochaine réconciliation devra porter sur la protection des branches et la référence de baseline, avec confirmation humaine avant tout déplacement de référence.
