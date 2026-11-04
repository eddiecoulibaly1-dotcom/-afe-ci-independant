# Supabase Production — proposition de remédiation du drift

Statut : **BROUILLON — lecture seule, non exécuté**  
Cible observée : projet Supabase `afe-ci-production`  
Branche de travail : `audit/hardening-v2-finalization`

## 1. Périmètre

Cette note ne constitue pas une migration et ne doit pas être placée dans `supabase/migrations/` sans approbation spécifique. Les requêtes d'introspection ont été exécutées en lecture seule. Aucun objet de base n'a été modifié.

## 2. Écarts confirmés sur le noyau Debate Engine

### Index dupliqués

Les paires suivantes ont des définitions identiques :

| Table | Index à conserver | Index redondant candidat |
|---|---|---|
| `debate_events` | `idx_debate_events_round_id` | `debate_events_round_idx` |
| `debate_evidence` | `idx_debate_evidence_round_id` | `debate_evidence_round_idx` |
| `debate_share_links` | `idx_debate_share_links_created_by` | `debate_share_links_created_by_idx` |
| `debate_shares` | `idx_debate_shares_shared_by` | `debate_shares_shared_by_idx` |

Statistiques `pg_stat_user_indexes` relevées à la date de la revue : `idx_debate_events_round_id` a 18 scans, son doublon 0 ; les deux index de `debate_evidence`, `debate_share_links.created_by` et `debate_shares.shared_by` ont 0 scan dans la fenêtre statistique observée. Ces compteurs sont réinitialisables et ne prouvent pas une absence d'utilisation historique.

**Précaution :** avant toute suppression, confirmer qu'aucune contrainte ne dépend de ces index, relever les statistiques avant/après et choisir une fenêtre de faible activité. Ne pas utiliser `CASCADE`.

SQL proposé, à exécuter uniquement après validation et sauvegarde :

```sql
begin;

drop index if exists public.debate_events_round_idx;
drop index if exists public.debate_evidence_round_idx;
drop index if exists public.debate_share_links_created_by_idx;
drop index if exists public.debate_shares_shared_by_idx;

commit;
```

Pour une base très active, privilégier une procédure opérationnelle avec `DROP INDEX CONCURRENTLY` hors transaction et vérifier la compatibilité avec l'outil de migration utilisé. Ne pas lancer ce bloc aveuglément depuis un runner qui encapsule les migrations dans une transaction.

### Politiques RLS redondantes

Sur `public.debates`, les politiques suivantes ont des prédicats `USING` / `WITH CHECK` identiques :

- `debates_select_access` et `debates_select_v09_access`
- `debates_update_access` et `debates_update_v09_access`

La base de test ne présente pas ces doublons. Conserver les politiques sans suffixe `v09` et retirer uniquement les deux doublons après validation :

```sql
begin;

drop policy if exists debates_select_v09_access on public.debates;
drop policy if exists debates_update_v09_access on public.debates;

commit;
```

Il faut confirmer immédiatement après l'opération que les deux politiques canoniques sont toujours présentes et que les tests d'accès propriétaire, membre workspace, éditeur partagé et utilisateur non autorisé donnent les résultats attendus.

## 3. Éléments de sécurité à ne pas modifier dans cette correction

Les advisors de production ont aussi remonté des fonctions `SECURITY DEFINER` accessibles à `authenticated` :

- `admin_record_farm_health`
- `admin_record_feed_consumption`
- `admin_update_farm_lot`

L'inspection de leurs définitions montre un contrôle interne du rôle administrateur via `profiles.role = 'admin'`. Leur accès ne doit pas être révoqué en bloc sans analyse des appels de l'application ELELY BIO FERME et tests avec un compte admin/non-admin.

`submit_public_order` est exécutable par `anon` et `authenticated`, ce qui correspond à un parcours de commande publique. La fonction valide le client, le téléphone, le panier, les produits actifs et le mode de paiement. Il ne faut pas supprimer son accès anonyme sans revoir le parcours de commande public, les protections anti-abus, les limites de débit et les règles de stock.

Le warning relatif à `match_semantic_dictionary` (RLS activé sans politique) concerne un autre domaine. Ne pas l'intégrer à une migration du Debate Engine.

La désactivation de la protection des mots de passe compromis est un réglage Auth du projet, pas une migration SQL ; elle doit faire l'objet d'une décision distincte après vérification des impacts utilisateur.

## 4. Plan de validation avant exécution

1. Exporter un snapshot / sauvegarde de Production et vérifier sa restauration.
2. Exécuter les suppressions d'index sur un environnement de test représentatif, mesurer les plans `EXPLAIN (ANALYZE, BUFFERS)` et vérifier les contraintes.
3. Exécuter les suppressions de politiques sur une copie de Production et tester les quatre profils RLS.
4. Relever le nombre d'index et de politiques avant/après.
5. Définir une fenêtre de maintenance et un plan de retour arrière (recréation des index et politiques).
6. Obtenir l'autorisation explicite avant tout changement sur Production.

## 5. État

- Production : aucune modification effectuée.
- Test : aucune modification effectuée.
- Migrations : aucune migration appliquée.
- Cette proposition est un document de préparation seulement.
