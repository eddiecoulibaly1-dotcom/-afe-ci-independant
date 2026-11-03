# AFE-CI — Revue sécurité du registre de prix et extension poussins

## État opérationnel

Les deux migrations SQL sont des fichiers de développement uniquement :
- `supabase/migrations/20261102120000_market_price_ledger.sql`
- `supabase/migrations/20261102150000_market_price_security_and_chicks.sql`

Aucune migration n'a été appliquée à Supabase. Aucun déploiement ni import réel n'a été exécuté.

## 1. Droits d'accès et isolation entre utilisateurs

- Chaque route marché passe par `authenticateRequest`, qui valide le jeton Bearer auprès de Supabase Auth.
- L'identifiant propriétaire est exclusivement `user.id` issu de cette validation ; le serveur ne prend pas `created_by` depuis le corps JSON.
- Les politiques RLS de lecture filtrent `created_by = auth.uid()`.
- Aucun droit d'écriture direct n'est accordé au rôle `authenticated`.
- Les écritures du serveur utilisent la clé secrète uniquement après authentification et les requêtes de lecture filtrent également par propriétaire.
- La migration complémentaire rend le fingerprint unique par propriétaire, et non globalement : deux utilisateurs peuvent importer le même tarif public dans leurs propres comptes.
- Une clé étrangère composite lie désormais chaque observation à un lot d'import appartenant au même utilisateur.

**Limite à valider en environnement Supabase :** les tests réels de RLS nécessitent deux comptes utilisateurs et une base de test. Ils ne peuvent pas être certifiés par la seule inspection du code.

## 2. Imports répétés

Le fingerprint est calculé à partir de l'identité de la source, de l'identifiant source, du produit, du type, du prix, de la devise, de l'unité, de la géographie et des dates d'observation/publication. Il n'inclut pas l'heure de récupération : réimporter le même relevé le lendemain ne crée donc pas une nouvelle cotation.

- Même utilisateur + même observation : doublon ignoré.
- Même utilisateur + prix ou date d'observation différente : nouvelle observation.
- Utilisateur différent + même observation : ligne indépendante grâce à l'index unique `(created_by, fingerprint)`.
- Chaque tentative d'import conserve son lot et ses compteurs, même si toutes les lignes sont des doublons.

## 3. Corrections successives et conservation de l'historique

Les observations restent append-only : UPDATE et DELETE sont refusés par le trigger SQL.

Une correction ajoute une nouvelle ligne avec `supersedes_id` et un motif obligatoire. L'index unique partiel sur `supersedes_id` bloque les corrections concurrentes d'une même version. Pour corriger à nouveau, l'utilisateur doit cibler la dernière version.

L'API d'historique a été renforcée : si elle reçoit l'identifiant d'une version intermédiaire ou de la dernière version, elle remonte d'abord jusqu'à la cotation initiale, puis redescend toute la chaîne de corrections.

## 4. Prix des poussins

Le répertoire fournisseur est exposé par `GET /market-prices/chick-catalog` (route authentifiée).

- Ivoire Poussins / SIPRA : contact prioritaire pour les prix des poussins d'un jour.
- Koudijs / Poussin d'Or : contact prioritaire pour les prix des poussins de chair et de ponte.
- Ivograin : fournisseur documenté principalement pour la nutrition animale ; vérifier directement s'il vend des poussins ou peut orienter vers un couvoir.

Aucun prix fournisseur n'est prérempli. Chaque cotation peut porter la souche, le statut vaccinal, la quantité minimale, la taille du carton, les frais de livraison, la ville et la date de disponibilité.

## 5. Vérifications encore nécessaires avant activation

Après approbation explicite et application sur un projet Supabase de test :
1. créer deux utilisateurs et vérifier qu'ils ne peuvent ni lire ni modifier les données de l'autre ;
2. importer deux fois le même CSV avec le même utilisateur ;
3. importer le même CSV avec le second utilisateur ;
4. corriger une cotation deux fois de suite et vérifier les trois versions ;
5. lancer deux corrections simultanées sur une même version et vérifier qu'une seule est acceptée ;
6. demander l'historique depuis l'identifiant initial puis depuis le dernier identifiant ;
7. vérifier les droits effectifs du rôle `service_role` et la vue `security_invoker`.

**Décision de sécurité :** ne pas appliquer les migrations sur le projet Supabase de production et ne pas déployer cette extension tant que ces tests n'ont pas été effectués et que l'utilisateur n'a pas donné son accord explicite.


Dernier passage CI : une première exécution a révélé une erreur de syntaxe dans la résolution de l'historique ; le correctif a été poussé ensuite. La validation complète du commit corrigé reste en attente du prochain résultat GitHub Actions.
