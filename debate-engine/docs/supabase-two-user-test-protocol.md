# Protocole de test Supabase — registre de prix AFE-CI

> Document de préparation. Ne pas exécuter sur le projet de production. Les migrations restent en attente d'approbation explicite.

## Environnement

1. Créer un projet Supabase de test séparé de la production.
2. Relever son URL et sa clé secrète serveur dans un gestionnaire de secrets local/CI. Ne jamais les inscrire dans ce document, dans Git, dans le navigateur ou dans un ticket.
3. Appliquer dans ce projet de test, dans l'ordre :
   - `20261102120000_market_price_ledger.sql`
   - `20261102150000_market_price_security_and_chicks.sql`
4. Vérifier que les deux migrations terminent sans erreur et que la vue `market_price_observations_current` est créée.
5. Créer deux comptes de test distincts A et B via Supabase Auth. Utiliser deux adresses de test contrôlées. Ne pas réutiliser les comptes réels de la ferme.

## Préparer les deux sessions

- Ouvrir une session A et une session B avec l'authentification normale de l'application.
- Récupérer un access token valide pour chaque session depuis le flux Auth ; ne pas coller les tokens dans GitHub, un chat ou un journal.
- Les requêtes API doivent porter `Authorization: Bearer <access_token>`.
- L'API doit déterminer `created_by` à partir du token validé. Ne jamais envoyer ni accepter un `created_by` fourni par le client.

Exemple de variables locales (terminal privé uniquement) :

```sh
export API_BASE="https://<URL_API_DE_TEST>"
export TOKEN_A="<ACCESS_TOKEN_A>"
export TOKEN_B="<ACCESS_TOKEN_B>"
```

## Jeu de données non réel

Créer un CSV de test avec une seule observation, source clairement marquée comme test, URL HTTPS de test, produit fictif et date d'observation fixe. Pour le scénario poussins, utiliser par exemple :
- produit : `Poussin de chair d'un jour — TEST`
- catégorie : `chick`
- souche : `Cobb 500 — TEST`
- unité : `FCFA/sujet`
- prix : valeur fictive clairement identifiée comme test
- source : `AFE-CI TEST`
- vaccination, quantité minimale, conditionnement, frais et disponibilité renseignés.

Ne jamais mélanger ces valeurs de test avec des tarifs commerciaux réels.

## Cas de test et résultats attendus

### T1 — Import initial utilisateur A
Importer le CSV avec le token A via `POST /market-prices/import`.
Attendu : une observation insérée, zéro doublon, un lot d'import créé.

### T2 — Réimport identique utilisateur A
Réimporter exactement le même CSV avec le token A.
Attendu : zéro observation supplémentaire, une ligne comptée comme doublon dans le nouveau lot. L'historique des lots conserve les deux tentatives.

### T3 — Même cotation importée par B
Importer le même CSV avec le token B.
Attendu : B obtient sa propre observation, indépendante de celle de A. Le fingerprint ne doit pas créer de collision entre utilisateurs.

### T4 — Isolation des lectures
Avec le token A, lister les cotations et consulter l'historique de l'observation de B.
Attendu : aucune donnée de B n'est retournée ; l'identifiant de B doit répondre comme introuvable/non autorisé.
Répéter dans l'autre sens avec le token B.

### T5 — Protection contre l'usurpation de propriétaire
Envoyer volontairement `created_by` de B dans le JSON d'import alors que la requête est authentifiée comme A.
Attendu : le serveur ignore/refuse ce champ et attribue toujours les écritures à A. Aucune ligne ne doit être créée au nom de B.

### T6 — Première correction A
Corriger la cotation A avec une valeur de test différente et un motif d'au moins huit caractères.
Attendu : nouvelle ligne immuable, `supersedes_id` pointe vers l'observation initiale ; l'ancienne valeur demeure dans la table.

### T7 — Deuxième correction successive A
Corriger la nouvelle version, pas la version initiale.
Attendu : troisième ligne ; chaîne complète initiale → correction 1 → correction 2.

### T8 — Historique demandé depuis chaque version
Appeler `GET /market-prices/:id/history` depuis l'ID initial, celui de la première correction, puis celui de la deuxième correction.
Attendu : même chaîne complète dans le bon ordre, avec les trois valeurs et les motifs de correction.

### T9 — Double correction concurrente
Lancer deux requêtes de correction en parallèle sur le même ID courant.
Attendu : une seule insertion réussit ; l'autre est rejetée par l'index unique partiel sur `supersedes_id`. Aucune branche concurrente ne doit apparaître.

### T10 — Immutabilité
Tenter une mise à jour ou une suppression directe d'une observation avec un rôle client.
Attendu : refus par les droits SQL et/ou le trigger append-only. Aucun changement de valeur historique.

### T11 — Données spécifiques poussins
Importer une cotation avec `productCategory=chick`, souche, statut vaccinal, quantité minimale, taille de conditionnement, frais de livraison et date de disponibilité.
Attendu : tous les champs sont persistés et conservés lors des corrections.

## Contrôles SQL de fin

À exécuter dans l'éditeur SQL du projet de test avec un compte administrateur, jamais à partir de l'application :

```sql
-- Vérifier la répartition des lots et observations par propriétaire.
select created_by, count(*) as batches
from public.market_price_import_batches
group by created_by;

select created_by, count(*) as observations
from public.market_price_observations
group by created_by;

-- Aucune observation ne doit être liée à un lot d'un autre propriétaire.
select o.id
from public.market_price_observations o
join public.market_price_import_batches b on b.id = o.batch_id
where o.created_by <> b.created_by;

-- Chaque version ne doit avoir qu'une correction directe au maximum.
select supersedes_id, count(*)
from public.market_price_observations
where supersedes_id is not null
group by supersedes_id
having count(*) > 1;

-- Voir les chaînes et les attributs poussins.
select id, created_by, product, value, currency, unit, product_category,
       strain, vaccination_status, minimum_quantity, pack_size,
       delivery_fee, availability_date, supersedes_id, correction_reason
from public.market_price_observations
order by created_at;
```

Les trois premières requêtes doivent retourner zéro ligne pour les anomalies ; les deux agrégats par propriétaire doivent montrer les données séparées.

## Critères d'acceptation

- Aucun utilisateur ne lit les données d'un autre utilisateur.
- Un même utilisateur peut importer plusieurs fois sans dupliquer les observations.
- Deux utilisateurs peuvent importer la même source sans collision.
- Une cotation peut être corrigée successivement sans perdre aucune version antérieure.
- Deux corrections simultanées de la même version ne peuvent pas réussir toutes les deux.
- Les attributs spécifiques des poussins sont conservés dans le registre et l'historique.
- Les données de test sont supprimées uniquement après validation et selon une procédure administrateur contrôlée ; ne jamais supprimer les observations historiques en production.

## Procès-verbal à remplir après exécution

| Test | Résultat | Preuve / ID de requête | Validé |
|---|---|---|---|
| T1 à T11 | À exécuter | À renseigner | Non |
