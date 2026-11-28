# Audit technique et opérationnel — AFE-CI Autonomous Organization

**Date :** 9 novembre 2026  
**Périmètre :** dépôt `eddiecoulibaly1-dotcom/-afe-ci-independant`, branche `feature/autonomous-organization-v1`, projet Supabase de test `wmvycdoebpvihexcdkdw`.  
**Exclusion :** aucune intervention sur la production, aucune migration appliquée pendant cet audit.

## 1. Synthèse

La base logicielle dispose déjà de contrôles significatifs : authentification fail-closed, isolation par workspace, exécution durable des missions, approbation humaine, revue indépendante des livrables, réconciliation des indicateurs et archivage des missions clôturées.

Contrôles exécutés dans un environnement Node 22 avec les dépendances du lockfile :
- `npm ci` : réussi ;
- `npm run typecheck` : réussi ;
- `npm test -- --test-reporter=spec` avant correction : 228/228 réussis ;
- après le correctif de protection de clôture des alertes : 229/229 réussis ;
- `npm audit --omit=dev` : 0 vulnérabilité signalée ;
- `git diff --check` : réussi.

Ces tests sont des tests automatisés de code. Ils ne remplacent pas une recette visuelle et fonctionnelle authentifiée dans le navigateur.

## 2. Constats prioritaires

### A1 — Clôture prématurée d'une alerte de blocage
**Risque : élevé — correctif initial réalisé.**

Le serveur permettait auparavant de passer directement une alerte à `resolved` sans vérifier que la tâche ou la mission associée avait effectivement cessé d'être bloquée. Le rafraîchissement ultérieur pouvait réouvrir l'alerte, mais la clôture temporaire restait trompeuse.

Correctif : avant de résoudre une alerte `task_blocked`, le serveur vérifie le statut et le motif de blocage de la tâche. Pour `mission_blocked`, il vérifie le statut et le motif de blocage de la mission. Si le blocage subsiste, l'API refuse la clôture avec HTTP 409. Un test de régression couvre cette règle.

Limite actuelle : le workflow complet (diagnostic formalisé, responsable d'action, échéance, pièces justificatives, vérification distincte et historique détaillé des actions) nécessite une évolution de schéma et d'interface, à traiter dans une tranche dédiée.

### A2 — Alertes actives observées dans la base de test
**Risque : élevé — traitement métier à organiser.**

La lecture de la table `afe_coo_alerts` a relevé 9 alertes actives :
- 5 alertes `task_blocked` au statut `open` ;
- 3 alertes `mission_blocked` au statut `open` ;
- 1 alerte `mission_blocked` au statut `acknowledged`.

Les quatre alertes visibles dans la capture sont cohérentes avec les enregistrements de test. L'audit n'a modifié aucun statut ni aucune donnée métier.

### A3 — Avis RLS « enabled without policy »
**Risque : à qualifier, pas une preuve de fuite.**

Supabase signale 20 tables avec RLS activé et sans politique RLS. Plusieurs tables de l'organisation autonome, de COO, d'alertes et d'événements sont concernées. Les migrations existantes les conçoivent comme des tables gérées côté serveur, avec révocation des privilèges des rôles navigateur et accès réservé au rôle serveur.

Action requise : vérifier systématiquement les privilèges effectifs, les fonctions SQL SECURITY DEFINER éventuelles, les routes serveur et les clés utilisées. Ne pas ajouter de politiques navigateur par réflexe : cela pourrait exposer des données ou contourner les contrôles applicatifs.

### A4 — Protection des mots de passe compromis désactivée
**Risque : moyen — configuration à examiner.**

L'avis Supabase Auth indique que la vérification des mots de passe compromis est désactivée. Cette option relève de la configuration Auth du projet. Elle n'a pas été modifiée pendant l'audit.

### A5 — Clés étrangères sans index couvrant
**Risque : moyen / dépend du volume.**

L'advisor performance signale 34 clés étrangères sans index couvrant. Les tables et relations concernées doivent être hiérarchisées selon les chemins de lecture/écriture réels et les volumes. Éviter une migration massive d'index sans mesure préalable.

## 3. Contrôles déjà présents à préserver

Les tests existants couvrent notamment :
- authentification et validation du jeton utilisateur ;
- séparation des espaces de travail ;
- approbations humaines et actions réservées ;
- exécution idempotente et reprise des missions ;
- dépendances de missions et verrouillage des prises en charge ;
- livrables obligatoires et revue indépendante ;
- cohérence des agrégats de reporting ;
- gouvernance des rôles et des directions ;
- archivage des missions et conservation de la décision finale de la DG.

Ces contrôles constituent une base de non-régression à conserver.

## 4. Programme d'amélioration recommandé

### P0 — Sécurisation et fiabilité
1. Finaliser le workflow d'alertes avec journal d'actions, attribution, diagnostic, plan correctif, échéance, preuve et validation.
2. Empêcher toute clôture d'alerte sans condition de résolution satisfaite et motif documenté.
3. Vérifier les autorisations serveur, l'isolation workspace et les privilèges DB sur toutes les routes COO.
4. Ajouter des tests de concurrence et de réouverture des alertes.

### P1 — Exécution opérationnelle
1. Cartographier les dépendances entre tâches et missions.
2. Détecter les causes communes de blocage et éviter les alertes redondantes.
3. Ajouter l'escalade au COO puis à la DG selon gravité et durée.
4. Vérifier les transitions de statut et les conditions de reprise des workers.

### P2 — Qualité des livrables et archivage
1. Lier explicitement chaque pièce à une mission et à une tâche.
2. Vérifier la présence des rapports DG et des rapports des directions avant clôture.
3. Contrôler la complétude des dossiers d'archives.
4. Préserver les instantanés et décisions historiques.

### P3 — Reporting et pilotage
1. Vérifier la réconciliation des indicateurs entre tableau de bord, rapports et données sources.
2. Distinguer stock, flux de période, retards et résultats vérifiés.
3. Ajouter des indicateurs de délai de résolution, réouverture et causes récurrentes.
4. Produire des rapports d'exception actionnables.

### P4 — Performance et exploitation
1. Mesurer les requêtes fréquentes et les tables volumineuses.
2. Prioriser les index manquants à partir des requêtes réelles.
3. Surveiller les erreurs API, workers, retries et temps de traitement.
4. Documenter les procédures de reprise et de sauvegarde.

## 5. Limites de cet audit

- Les tests automatisés ont été exécutés localement dans le sandbox, pas dans le navigateur de l'utilisateur.
- Le Preview est protégé ; la recette visuelle authentifiée reste à faire.
- Les recommandations Supabase sont des signaux d'analyse, pas des preuves automatiques de vulnérabilité ou de lenteur.
- Les données métier du projet de test n'ont pas été modifiées.
- Aucune migration n'a été appliquée et aucune action n'a été menée sur la production.

## 6. Critères de sortie avant toute mise en production

- Typecheck et tests complets verts ;
- revue de sécurité et privilèges DB validés ;
- tests de non-régression des alertes et dépendances ;
- recette authentifiée des parcours critiques ;
- vérification des rapports, dossiers et pièces d'archives ;
- déploiement Preview validé ;
- autorisation explicite de la Direction générale avant toute promotion.
