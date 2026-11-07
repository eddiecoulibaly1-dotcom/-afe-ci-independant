# AFE-CI — Moteur d'orchestration du COO IA

**Version :** 1.0.0  
**Date :** 7 novembre 2026  
**Environnement :** Preview + Supabase de test uniquement  
**Statut :** Moteur implémenté sur la branche de travail ; recette fonctionnelle authentifiée encore requise.

## 1. Mandat

Le COO IA reçoit une instruction de la Direction générale humaine, l'analyse, consulte le catalogue des directions et de leurs responsables IA, construit un plan structuré puis crée des missions et tâches dans la file durable existante.

Le COO est un orchestrateur opérationnel. Il ne se substitue ni à la DG, ni à l'Audit interne indépendant, ni à l'Arbitrage indépendant, ni à l'Autorité de validation humaine.

## 2. Cycle d'orchestration

1. La DG propriétaire de l'espace transmet une instruction via `POST /team/api/workspaces/:workspaceId/coo/orchestrate`.
2. Le serveur vérifie l'identité humaine initiatrice, le workspace, la désignation COO, son statut, son niveau d'autonomie, le drapeau d'activation et le kill switch.
3. Le moteur charge uniquement les directions actives non indépendantes et non réservées à l'humain, ainsi que leurs directeurs IA actifs.
4. Le modèle COO produit un plan JSON contraint : synthèse, chantiers, directions, objectifs, priorités, échéances relatives, tâches, hypothèses et décisions réservées.
5. Le serveur valide de nouveau chaque direction, responsable, titre, objectif, échéance et limite de volume. Le modèle ne peut pas créer de direction ni choisir un agent hors du catalogue autorisé.
6. Si le plan demande une décision réservée à l'humain, le run passe à `approval_required` et aucune mission n'est distribuée.
7. Le serveur prévalide l'intégralité du plan avant la première écriture : direction, directeur, objectifs et toutes les tâches. Un plan invalide ne provoque donc aucune délégation partielle.
8. Sinon, le serveur crée une mission par direction et les tâches correspondantes, affectées au directeur IA de cette direction. Les identifiants de tâches sont ajoutés au contexte de mission puis la mission rejoint la file durable existante.
9. L'agent exécutant doit retourner un résultat structuré pour chaque tâche. Le worker met à jour les tâches terminées, en cours ou bloquées. Une mission dont toutes les tâches ne sont pas terminées est mise en pause et génère un événement de suivi ; elle n'est pas déclarée terminée artificiellement.
10. Le run, les événements et l'audit enregistrent l'identité COO, l'initiateur humain, les délégations et les résultats.

## 3. Niveau d'autonomie

- **Niveau 1** : observation, analyse et propositions.
- **Niveau 2 (actif en test)** : planification, création de missions et tâches, délégation aux directeurs IA actifs, suivi et relances opérationnelles dans le workspace.
- **Niveau 3 (verrouillé)** : non disponible avant recette de sécurité, tests d'intégration, preuve d'idempotence, validation de la DG et délégation distincte.

Le niveau 2 n'autorise pas les paiements, engagements financiers, signatures, publications, modifications d'accès, changements de secrets, migrations Production, déploiements Production, arbitrages ou validations humaines.

## 4. Contrôles de sécurité

- Toutes les lectures et écritures sont filtrées par `workspace_id`.
- L'agent COO doit être l'agent dédié `afe-ci-coo`, actif et affecté à la Direction des Opérations.
- Le moteur est déclenché par une requête authentifiée de la DG propriétaire de l'espace ; un agent n'est pas simulé comme utilisateur Auth.
- Les directions indépendantes, la Direction générale et les fonctions `human_only` ne sont pas éligibles à la délégation.
- Les directeurs doivent être actifs et rattachés à la direction ciblée.
- Les plans sont limités à 8 chantiers et 8 tâches par chantier au maximum ; les paramètres workspace peuvent réduire ces plafonds.
- Les échéances relatives sont bornées à 1–720 heures.
- Les runs sont idempotents par workspace et clé.
- Le kill switch empêche toute nouvelle orchestration. Il ne supprime pas et n'annule pas silencieusement les missions déjà distribuées.
- Les résultats d'exécution restent produits par les agents responsables dans la file durable existante ; le COO ne peut pas les falsifier.
- Les décisions nécessitant une approbation humaine arrêtent la distribution.

## 5. Données

- `afe_coo_settings` : `coo_agent_id`, `coo_enabled`, `coo_autonomy_level`, `coo_kill_switch`, limites de chantiers/tâches.
- `afe_coo_runs` : instruction, initiateur, agent COO, plan, état, nombre de missions, idempotence et diagnostic.
- `afe_agent_missions` : missions déléguées aux agents responsables.
- `afe_operational_tasks` : tâches concrètes affectées aux directions et agents.
- `afe_agent_events` et `debate_workspace_audit` : traçabilité des délégations.

La table `afe_coo_runs` est protégée par RLS et inaccessible aux rôles navigateur `anon` et `authenticated`. Le backend serveur utilise le secret Supabase déjà présent côté serveur ; aucune clé privilégiée n'est exposée au navigateur ni transmise au modèle.

## 6. Configuration actuelle de l'environnement de test

- Agent COO : `afe-ci-coo`
- Statut : actif
- Niveau de l'agent : 2
- Niveau de configuration : 2
- Moteur : activé
- Kill switch : inactif
- Espace : `AFE-CI GOUVERNANCE & CONFORMITÉ`

## 7. Recette obligatoire avant autonomie étendue

1. Vérifier l'accès à la page COO dans une session authentifiée.
2. Transmettre une instruction non sensible et vérifier le plan.
3. Vérifier les missions et tâches créées pour chaque direction, sans doublon.
4. Vérifier le traitement d'une direction sans directeur actif.
5. Vérifier qu'une proposition de décision réservée est mise en attente sans distribution.
6. Vérifier le kill switch.
7. Vérifier les journaux et le rapport DG.
8. Simuler un échec d'un agent et vérifier l'alerte et l'escalade.
9. Exécuter typecheck et l'ensemble des tests.
10. Faire approuver séparément toute montée au niveau 3.

## 8. Protection

Le code et la migration sont limités à `feature/autonomous-organization-v1` et au projet Supabase de test `afe-ci-test`. Aucun merge, aucune modification de `main`, de la baseline V1.0.7 ou de la Production n'est autorisé par ce document.
