# Protocole de test Supabase — registre des prix AFE-CI

**Statut : protocole préparé, non exécuté.** Il ne faut pas appliquer les migrations sur le projet Supabase de production. Utiliser un projet Supabase de test isolé, après autorisation explicite de l'utilisateur pour y appliquer les migrations.

## 0. Préparation sécurisée

1. Créer ou désigner un projet Supabase de test distinct de la production.
2. Sauvegarder la configuration et noter le Project URL.
3. Créer deux comptes de test indépendants, Utilisateur A et Utilisateur B, avec deux adresses contrôlées.
4. Obtenir leurs sessions via Supabase Auth : deux JWT distincts.
5. Configurer l'API AFE-CI de test avec l'URL et la clé secrète du projet de test uniquement. Ne jamais placer la clé secrète/service-role dans le navigateur, les captures ou les journaux.
6. Appliquer les migrations dans l'ordre uniquement après approbation :
   - `20261102120000_market_price_ledger.sql`
   - `20261102150000_market_price_security_and_chicks.sql`
7. Vérifier que les tables et la vue existent, et que les deux utilisateurs ont un profil Auth valide.

Variables nécessaires au serveur de test : `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (ou ancienne `SUPABASE_SERVICE_ROLE_KEY`). Les JWT utilisateurs sont fournis dans l'en-tête Authorization des requêtes API. Ne pas demander ni partager les secrets dans un ticket.

## 1. Matrice d'accès / isolation

| Test | Action | Résultat attendu |
|---|---|---|
| A1 | A appelle `GET /market-prices` sans données | Liste vide |
| A2 | A importe une cotation | Une ligne créée avec `created_by = A` |
| B1 | B appelle `GET /market-prices` | Ne voit aucune ligne de A |
| B2 | B demande l'historique avec l'ID de A | HTTP 404, aucune donnée révélée |
| B3 | B tente de corriger l'ID de A | HTTP 400/404, aucune modification |
| B4 | B importe le même CSV que A | Une ligne distincte créée pour B |
| A3 | A relit ses cotations | Ne voit que ses propres lignes |
| RLS1 | Appel PostgREST direct avec le JWT A pour lire la ligne de B | Zéro ligne |
| RLS2 | Tentative INSERT/UPDATE/DELETE direct avec JWT A | Refusée par les privilèges/politiques |
| Batch1 | Essayer d'associer une observation de A au lot d'import de B | Refus par la FK composite |

Pour les appels API, toujours envoyer `Authorization: Bearer <JWT utilisateur>`. Ne jamais envoyer le JWT A dans le test B ni utiliser la clé secrète pour simuler un utilisateur final.

## 2. Test des imports répétés

Préparer un CSV de test contenant une cotation fictive clairement marquée comme donnée de test :
- identifiant source : `TEST-CHICK-001`
- produit : poussin de chair d'un jour
- souche : Cobb 500
- valeur : 650 XOF / sujet
- source : `FOURNISSEUR TEST`
- ville : Abidjan
- date d'observation : date fixe du scénario

Séquence :
1. A importe le CSV une première fois : `inserted = 1`, `duplicates = 0`.
2. A réimporte exactement le même CSV : `inserted = 0`, `duplicates = 1`.
3. A réimporte le même relevé avec une heure `retrievedAt` différente, mais mêmes données source, prix et date d'observation : toujours un doublon.
4. A importe un relevé avec une nouvelle date d'observation ou un prix réellement différent : une nouvelle observation.
5. B importe le premier CSV identique : une ligne indépendante pour B.
6. Vérifier les lots d'import : chaque tentative possède son propre lot et ses compteurs, même lorsque toutes les observations sont des doublons.

Résultat attendu : l'index unique `(created_by, fingerprint)` empêche les doublons pour un même utilisateur sans fusionner les registres de deux utilisateurs.

## 3. Test de corrections successives et de concurrence

À partir de la cotation initiale créée par A :
1. Corriger 650 en 660 FCFA avec un motif explicite.
2. Corriger ensuite la version 660 en 655 FCFA avec un second motif.
3. Demander l'historique avec l'ID initial : trois versions, dans l'ordre 650 → 660 → 655.
4. Demander l'historique avec l'ID de la version intermédiaire : le même historique complet.
5. Demander l'historique avec l'ID de la dernière version : le même historique complet.
6. Vérifier dans la table de base que les trois lignes existent, que les deux anciennes valeurs n'ont pas changé, et que chaque correction référence la version précédente via `supersedes_id`.
7. Vérifier que la vue `market_price_observations_current` ne présente que la dernière version.
8. Lancer deux requêtes de correction quasi simultanées sur la même version courante : une seule doit réussir ; l'autre doit échouer sur l'index unique partiel.
9. Tenter une correction avec un motif de moins de huit caractères : refus.
10. Tenter de corriger la cotation d'un autre utilisateur : refus sans divulguer son existence.

## 4. Contrôles SQL en lecture seule

À exécuter dans le SQL Editor du projet de test après application approuvée :

```sql
-- Les deux tables doivent avoir RLS activé.
select relname, relrowsecurity
from pg_class
where relname in ('market_price_import_batches', 'market_price_observations');

-- Vérifier les politiques RLS.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where tablename in ('market_price_import_batches', 'market_price_observations');

-- Vérifier les index d'isolation, de dédoublonnage et de correction unique.
select tablename, indexname, indexdef
from pg_indexes
where tablename in ('market_price_import_batches', 'market_price_observations')
order by tablename, indexname;

-- Vérifier les droits des rôles clients et du serveur.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('market_price_import_batches', 'market_price_observations')
order by table_name, grantee, privilege_type;
```

Ces requêtes ne modifient aucune donnée. Les résultats doivent confirmer : RLS activé, SELECT limité aux propriétaires pour authenticated, aucune écriture client directe, et droits d'écriture uniquement au serveur.

## 5. Critères de validation

Le protocole est réussi uniquement si :
- aucun utilisateur ne lit ou ne corrige les données de l'autre ;
- les imports répétés ne créent pas de doublons pour un même utilisateur ;
- le même relevé reste indépendant entre A et B ;
- les corrections sont append-only et sérialisées ;
- l'historique complet reste consultable depuis n'importe quelle version ;
- la vue courante ne montre que la dernière correction ;
- les anciennes versions restent inchangées ;
- aucune clé secrète n'est exposée au client.

Consigner les résultats (date, commit, projet de test, tests réussis/échoués) sans copier de JWT ni de secret. En cas d'échec, ne pas déployer et corriger d'abord le schéma ou l'API.

## 6. Hors périmètre / interdictions

- Ne pas appliquer ces migrations à la production pendant cette campagne.
- Ne pas importer de vrais prix fournisseurs ou données personnelles dans le jeu de test.
- Ne pas fusionner la branche, lancer de paiement, ni déployer en production.
- Ne pas considérer un échec de déploiement Vercel comme un résultat de test Supabase : ce sont deux contrôles différents.
