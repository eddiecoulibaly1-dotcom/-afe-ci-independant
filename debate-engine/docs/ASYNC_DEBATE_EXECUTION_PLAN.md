# AFE-CI — Plan de correction de l'exécution des débats

Branche cible : `feature/debate-engine-v2-1`

## Décision d'architecture

Ne pas conserver un débat complet dans une seule requête HTTP. Vercel peut interrompre la requête avant la fin du cycle multi-agents. Le moteur doit devenir une machine à états durable, pilotée par étapes courtes et idempotentes.

### Constat vérifié sur le code actuel

- `POST /debates/run` appelle `runDebate()`, attend la totalité des tours puis appelle `saveDebate()`. La réponse HTTP n'est envoyée qu'à la fin.
- `runDebate()` exécute séquentiellement Architecte, Red Team et Arbitre pour chaque tour.
- La persistance Supabase actuelle écrit le débat et ses tours après l'exécution complète ; elle ne constitue donc pas un journal de progression exploitable pendant le traitement.
- `callGemini()` effectue jusqu'à trois tentatives et impose un timeout HTTP minimal de 10 secondes. La valeur `FALLBACK_TIMEOUT_MS=5000` ne garantit donc pas un délai réel de 5 secondes.
- Le schéma actuel utilise `debates.status` avec les états existants et `debate_events` pour les événements. Une migration additive est préférable à toute modification destructive.

## Architecture cible

### 1. Création rapide

`POST /debates` (ou conservation de `POST /debates/run` en mode compatibilité) :
- valide l'utilisateur, la question et l'accès au workspace ;
- crée un débat avec `status=running` ;
- initialise un état d'exécution durable ;
- retourne immédiatement `202 Accepted`, `debateId`, `status` et l'URL de suivi.

Aucun appel de modèle ne doit être effectué pendant cette requête.

### 2. Avancement par étapes

Un appel authentifié `POST /debates/:id/advance` traite une seule unité de travail :
- Architecte du tour N ;
- Red Team du tour N ;
- Arbitre du tour N ;
- préparation du tour suivant, ou clôture.

Chaque étape doit avoir une clé d'idempotence composée du débat, du tour et du rôle. Une étape déjà terminée ne doit jamais être facturée ou exécutée une seconde fois lors d'une répétition réseau.

Le client appelle l'endpoint d'avancement étape par étape. Une requête ne doit jamais porter les neuf appels potentiels d'un débat de trois tours.

### 3. Journal durable et reprise

Ajouter une table dédiée `debate_execution_steps` (migration additive) :
- `id`, `debate_id`, `round_number`, `agent_role`, `status` ;
- `attempt_count`, `input_snapshot`, `output_payload`, `error_code`, `error_message` ;
- `started_at`, `completed_at`, `created_at`, `updated_at` ;
- contrainte unique sur `(debate_id, round_number, agent_role)`.

États d'étape : `pending`, `running`, `completed`, `failed`. La revendication d'une étape doit être atomique (mise à jour conditionnelle ou fonction SQL) pour empêcher deux requêtes concurrentes de lancer le même agent.

Après chaque agent, enregistrer son résultat dans `debate_events` et dans la table de tours lorsque le tour est complet. Le débat reste `running` tant que l'Arbitre final n'a pas été enregistré. En cas d'échec définitif, conserver les étapes terminées et marquer le débat `failed` avec un diagnostic exploitable.

### 4. Suivi et interface

`GET /debates/:id/status` retourne uniquement :
- statut global ;
- tour courant et rôle courant ;
- étapes terminées / en attente / échouées ;
- horodatages et message d'erreur non sensible.

L'interface du laboratoire :
- reçoit immédiatement l'identifiant du débat ;
- affiche « En cours » et la progression ;
- déclenche une étape à la fois et actualise l'état ;
- permet de reprendre un débat interrompu ;
- ne crée jamais un deuxième débat lorsqu'on clique sur « Réessayer » après une coupure réseau.

### 5. Fiabilité des fournisseurs

Dans `providers.ts` :
- une seule tentative par fournisseur par étape par défaut ;
- aucun retry automatique caché ;
- timeout effectif explicite, sans prétendre respecter un timeout inférieur au minimum du SDK ;
- budget total par étape et annulation si le budget est dépassé ;
- secours Gemini/OpenAI uniquement selon la politique configurée ;
- erreurs structurées et traçables, sans exposer les secrets.

Le réglage actuel `FALLBACK_TIMEOUT_MS=5000` doit être traité comme une valeur non fiable tant que le timeout SDK minimal est supérieur.

## Séquence de réalisation

1. Migration additive et fonctions Supabase atomiques pour créer, revendiquer, terminer et échouer une étape.
2. Service d'orchestration d'une étape (un agent par requête) et tests d'idempotence/concurrence.
3. Routes API de création, avancement et suivi, protégées par l'authentification existante.
4. Adaptation du laboratoire pour piloter le workflow et reprendre une exécution.
5. Réduction des retries et application des budgets temporels fournisseur.
6. Tests unitaires, tests API et tests de persistance.
7. Déploiement Preview seulement ; validation manuelle ; aucune migration ni variable Production sans autorisation séparée.

## Critères d'acceptation

- La création retourne rapidement un identifiant sans appeler OpenAI ni Gemini.
- Une requête d'avancement exécute au maximum un agent.
- Une coupure réseau puis une répétition ne duplique pas l'appel déjà terminé.
- Les résultats partiels sont lisibles après rechargement de la page.
- Deux appels concurrents ne peuvent pas revendiquer la même étape.
- Un échec fournisseur ne détruit pas les résultats précédemment enregistrés.
- Un débat de trois tours n'est plus dépendant d'une unique requête longue.
- Les tests et le déploiement Preview passent avant toute promotion Production.

## Hors périmètre de cette première préparation

- Aucun changement de la branche `main`.
- Aucune modification des variables Production.
- Aucune migration exécutée sur Supabase.
- Aucun paiement ou appel fournisseur réel déclenché par cette préparation.
