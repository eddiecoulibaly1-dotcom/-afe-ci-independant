# Registre de réconciliation des migrations Supabase — AFE-CI Debate Engine

Date du contrôle : 2026-11-04  
Branche d'audit : `audit/hardening-v2-finalization`  
Commit contrôlé initial : `64c2237bdf259fd81aedae8457ae15817300de4d`  
Mises à jour du registre : migrations de Test appliquées le 2026-11-04 ; commits Git de suivi postérieurs  
Projets interrogés en lecture seule :
- Production : `afe-ci-production` (`cyelvzywwqymxnziupxk`)
- Test : `afe-ci-test` (`wmvycdoebpvihexcdkdw`)

## 1. Règle de lecture

Ce registre distingue trois faits indépendants :
1. le fichier SQL est présent dans Git ;
2. une entrée correspondante existe dans `supabase_migrations.schema_migrations` ;
3. l'objet ou le comportement attendu est effectivement présent dans PostgreSQL.

Une entrée d'historique ne prouve pas à elle seule que le schéma courant est correct. Inversement, un objet présent dans PostgreSQL ne prouve pas que sa migration est tracée. Les versions et noms enregistrés par Supabase peuvent différer du nom du fichier source : les correspondances ci-dessous sont des correspondances fonctionnelles, pas une égalité de chaînes.

## 2. Inventaire Git des migrations Debate Engine

| Fichier dans la branche d'audit | Domaine / effet | Test | Production |
|---|---|---|---|
| `20261102120000_market_price_ledger.sql` | Tables de lots et observations, append-only, RLS et vue courante | Appliquée (nom enregistré suffixé) | Absente, intentionnel |
| `20261102150000_market_price_security_and_chicks.sql` | Empreinte par propriétaire, correction unique, FK batch-propriétaire, métadonnées poussins | Appliquée (nom enregistré suffixé) | Absente, intentionnel |
| `20261102160000_market_price_advisor_hardening.sql` | search_path des fonctions, politiques de lecture et index de support | Appliquée (nom enregistré suffixé) | Absente, intentionnel |
| `20261102170000_refresh_market_price_current_view.sql` | Recréation de la vue après ajout des colonnes | Appliquée (nom enregistré suffixé) | Absente, intentionnel |
| `20261103141000_afe_ci_debate_engine_core_schema_v1.sql` | Schéma noyau Debate Engine et politiques initiales | Appliquée | Pas d'entrée correspondante ; schéma préexistant via l'historique V1 antérieur |
| `20261103141050_afe_ci_debate_workspace_fk.sql` | FK workspace et rechargement du cache API | Appliquée sous un nom différent | Pas d'entrée correspondante identifiée ; FK présente |
| `20261103141100_afe_ci_debate_rls_outer_reference_hardening.sql` | Qualification des références externes dans les politiques RLS | Appliquée sous nom/version différents | Appliquée sous nom/version différents |
| `20261103141200_afe_ci_debate_foreign_key_indexes.sql` | Index FK canoniques des tables enfants/partage | Appliquée sous nom/version différents | Appliquée sous nom/version différents |
| `20261103141300_afe_ci_debate_child_read_rls_policies.sql` | Politiques SELECT des tables enfants | Appliquée sous nom/version différents | Appliquée sous nom/version différents |
| `20261103141400_afe_ci_debate_realtime_publication.sql` | Publication Realtime et replica identity | Appliquée sous nom/version différents | Appliquée sous nom/version différents |
| `20261103143000_afe_ci_debate_allow_provisional_status.sql` | Ajout de l'état terminal `provisional` | Appliquée sous nom/version différent | Effet déjà présent via migration antérieure `allow_provisional_debate_status_v2` |
| `20261103144000_afe_ci_debate_execution_steps.sql` | Journal durable des étapes, leases et RPC | Appliquée sous nom/version différents | Appliquée sous nom/version différents |
| `20261103144100_afe_ci_debate_execution_steps_service_role_policy.sql` | Politique RLS service_role du journal | Appliquée sous nom/version différents | Appliquée sous nom/version différents |
| `20261103210000_afe_ci_debate_execution_step_retry_hardening.sql` | Reprises bornées, validation des leases | Appliquée sous nom/version différents | Appliquée sous nom/version différents |
| `20261103231000_afe_ci_debate_execution_step_recovery_limit.sql` | Relèvement de la limite de tentatives de 3 à 8 | **Non enregistrée ; fonction actuellement à 3** | **Non enregistrée ; fonction actuellement à 8** |
| `20261104120000_afe_ci_debate_duplicate_policy_index_cleanup.sql` | Retrait de 2 politiques RLS et 4 index redondants | Non nécessaire à l'état courant : doublons absents | **Non appliquée** — objets redondants toujours présents |\n| `20261104130000_afe_ci_workspace_admin_membership_alignment.sql` | Alignement des politiques de gestion des membres owner/admin | **Appliquée le 2026-11-04** | Déjà alignée sur la politique existante |

Le fichier historique racine `supabase/migrations/20261027_allow_provisional_debate_status.sql` porte également le changement d'état `provisional`. Il ne doit pas être rejoué sur une base dont la contrainte accepte déjà cet état.

## 3. État constaté des environnements

### Production

- Les tables du noyau sont présentes, y compris `debate_execution_steps`.
- Les signatures de schéma du noyau avaient été comparées à Test et sont structurellement cohérentes ; les journaux d'historique sont différents.
- Les migrations du sous-système Market Intelligence ne sont pas présentes et les tables marché sont absentes : c'est cohérent avec `MARKET_INTELLIGENCE_ENABLED=false`.
- Les quatre paires d'index redondants identifiées sont encore présentes :
  - `debate_events_round_idx` / `idx_debate_events_round_id`
  - `debate_evidence_round_idx` / `idx_debate_evidence_round_id`
  - `debate_share_links_created_by_idx` / `idx_debate_share_links_created_by`
  - `debate_shares_shared_by_idx` / `idx_debate_shares_shared_by`
- Les deux paires de politiques redondantes sur `debates` sont encore présentes : `debates_select_access` / `debates_select_v09_access` et `debates_update_access` / `debates_update_v09_access`.
- La fonction `claim_debate_execution_step` limite déjà `attempt_count < 8`, mais aucune entrée de migration correspondante n'est visible dans le journal. C'est une dérive de traçabilité : ne pas réappliquer aveuglément une fonction déjà modifiée.
- Les politiques de gestion des membres de workspace autorisent le propriétaire et les rôles `owner/admin` à gérer les membres.

### Test

- Les quatre migrations Market sont enregistrées et les tables Market Intelligence existent.
- Le schéma noyau et les migrations d'exécution sont enregistrés ; certains noms/versionnements du journal diffèrent des noms de fichiers Git.
- La fonction `claim_debate_execution_step` limite encore `attempt_count < 3` : le comportement n'est pas aligné sur le fichier Git de limite à 8 ni sur Production.
- Les politiques `debate_workspace_members_owner_insert/update/delete` réservent la gestion des membres au propriétaire, alors que Production et le code applicatif prévoient aussi le rôle `admin`.
- Les politiques de doublon et index legacy ciblés par la migration de nettoyage ne sont pas présentes en Test. La migration de nettoyage n'y est donc pas nécessaire pour le schéma courant.

## 4. Écarts à fermer

| ID | Écart | Risque / impact | Action requise | État |
|---|---|---|---|---|
| DB-01 | Limite de reprise 3 en Test vs 8 en Git et Production | Comportement d'orchestration différent entre environnements | Migration appliquée en Test ; fonction vérifiée à 8 en Test et Production. L'origine historique du patch Production reste à tracer | **Corrigé fonctionnellement ; traçabilité Production à documenter** |
| DB-02 | Gestion des membres : owner-only en Test vs owner/admin en Production et dans le serveur | Tests d'intégration ne reflétaient pas les permissions de production | Migration d'alignement appliquée en Test ; politiques vérifiées présentes. Les tests RLS multi-utilisateurs restent à ajouter ; auditer séparément la promotion au rôle owner | **Aligné au niveau des politiques ; tests RLS restant** |
| DB-03 | 2 politiques RLS et 4 index redondants encore en Production | Dette de performance et d'auditabilité | Après sauvegarde vérifiée et fenêtre calme, exécuter la migration de nettoyage ; contrôler les objets avant/après | En attente d'autorisation d'exécution Production |
| DB-04 | Migration de nettoyage absente des historiques Test et Production | Traçabilité incomplète | Ne pas l'enregistrer manuellement ; exécuter le fichier validé là où il est nécessaire, puis vérifier le journal | En attente |
| DB-05 | Migration de recovery limit absente du journal alors que Production applique déjà le comportement 8 | Dérive entre état effectif et historique | Conserver la preuve SQL de l'état courant ; ajouter une note de réconciliation non destructive, ne pas rejouer en Production sans raison | À documenter |
| DB-06 | `debates_update_access` autorise dans son `WITH CHECK` le cas `workspace_id IS NULL` indépendamment du propriétaire | Risque latent si un privilège UPDATE est un jour accordé à `authenticated` | Ne pas accorder UPDATE à `authenticated`. Préparer une politique plus stricte couvrant explicitement propriétaire, membre autorisé et éditeur partagé avant tout changement de privilège | Garde-fou actif, correction préventive à préparer |

## 5. Décisions et garde-fous

- Ne pas exécuter en Production la migration de création du schéma noyau : les tables sont déjà présentes et l'historique antérieur est la source de vérité historique.
- Ne pas appliquer les migrations Market en Production tant que ce module n'est pas explicitement activé et provisionné.
- Ne pas insérer ou modifier manuellement des lignes dans `schema_migrations` pour faire correspondre artificiellement les noms.
- Ne pas supprimer les index ni politiques en Production avant sauvegarde/restauration vérifiée, revue du SQL final et autorisation de la fenêtre de maintenance.
- Ne pas accorder de privilège `UPDATE` sur `debates` à `authenticated` tant que la politique `WITH CHECK` n'a pas été durcie et testée.
- La divergence des droits workspace doit être testée avec au minimum propriétaire, administrateur, éditeur, lecteur et utilisateur extérieur.
- Le module Market reste optionnel et son interrupteur serveur reste désactivé par défaut.

## 6. Critères de clôture de cette étape

Cette étape ne sera déclarée complètement réconciliée que lorsque :
1. Test et Production ont les mêmes comportements attendus pour les migrations et politiques du noyau, ou chaque différence est documentée et approuvée ;
2. la limite de reprise est identique et vérifiée à 8 ;
3. les droits workspace sont décidés, alignés et testés avec plusieurs utilisateurs ;
4. les objets redondants de Production sont retirés après sauvegarde vérifiée, puis le résultat est contrôlé ;
5. le registre des migrations est actualisé après chaque opération, sans falsifier l'historique ;
6. CI, typage, tests SQL statiques et tests d'accès RLS sont verts ;
7. aucune migration Market n'est appliquée en Production par inadvertance.

**Mise à jour au 2026-11-04 :** DB-01 est corrigé fonctionnellement en Test et vérifié à 8 tentatives dans les deux environnements. DB-02 est aligné au niveau des politiques. Aucune modification n'a été faite en Production. DB-03/DB-04 restent bloqués par la sauvegarde/restauration vérifiée et l'autorisation d'exécuter la migration de nettoyage. DB-05 reste une anomalie de traçabilité Production ; DB-06 reste un garde-fou à traiter avant tout octroi de privilège UPDATE à `authenticated`.
