# AFE-CI — Audit technique approfondi (preuves de dépôt)
Date: 2026-11-06
Branche auditée: feature/autonomous-organization-v1
Base de comparaison: feature/team-governance-engine
Périmètre: code et migrations présents dans le dépôt GitHub. Aucun accès direct aux journaux de Production ni à son code déployé n'a été utilisé.

## 1. Résumé exécutif

La branche contient une fondation multi-agents exploitable: API workspace-scoped, tables dédiées, RLS activée, worker serveur, claims avec lease/fencing token, délégation task/handoff, approbations humaines et interface de supervision.

Elle ne constitue pas encore une plateforme de délibération autonome complète. Le worker produit un livrable JSON unique par mission. Il ne collecte pas de preuves techniques de lui-même, ne réalise pas de dialogue multi-tours, ne suit pas de graphe parent/enfants et ne produit pas d'arbitrage contradictoire. Le résultat récent de contre-analyse confirme la bonne exécution du transport de délégation et du worker, mais pas la véracité indépendante des constats.

## 2. Éléments vérifiés dans le dépôt

| Domaine | Preuve consultée | Constat |
|---|---|---|
| Runtime | `debate-engine/package.json` | Application Node/TypeScript existante; scripts typecheck et tests Node natifs. |
| Worker | `debate-engine/src/autonomous-agents/worker.ts` | Authentification Bearer avec comparaison constante, claim serveur, appel modèle, fin protégée par lease et retries bornés. |
| API workspace | `debate-engine/src/autonomous-agents/platform.ts` | Vérification serveur de l'appartenance et du rôle avant opérations; exécution manuelle limitée à Preview et administrateurs. |
| Schéma | `debate-engine/supabase/migrations/20261105230000_autonomous_agents_p0_foundation.sql` | Tables agents, missions, runs, steps, événements, messages, mémoire, approbations; relations composites workspace. |
| Contrôles SQL | même migration | RLS activée; privilèges anon/authenticated révoqués; service_role utilisé côté serveur. |
| Délégation | migrations P8/P9 | Dispatch borné, `FOR UPDATE SKIP LOCKED`, création idempotente d'une mission destinataire via `source_message_id`. |
| Approbation | migrations P8/P9 | Demande atomique, mission suspendue, claims bloqués tant qu'une approbation est pending; décision côté serveur. |
| Preview | `debate-engine/vercel.json` | Cron configuré à la minute; la documentation du dépôt précise que le Cron Vercel ne s'exécute que sur Production. |
| Tests | `debate-engine/test/autonomous-agent-worker.test.ts`, `autonomous-agent-p8-p9.test.ts`, `autonomous-organization-foundation.test.ts` | Tests principalement statiques sur le texte SQL/TypeScript; ils ne prouvent pas à eux seuls les scénarios concurrents ou E2E. |

## 3. Constats et risques

### A-01 — Absence de collecte de preuves dans le worker
**Sévérité: élevée · Statut: confirmé dans le code**

Le worker charge la mission et l'agent, puis appelle `callModel` avec le mandat, l'objectif et `input_context`. Aucun outil de lecture du dépôt, d'inspection de migrations, de collecte de logs ou de citation de lignes n'est appelé dans ce parcours.

**Conséquence:** un agent chargé d'auditer le logiciel peut produire une analyse plausible sans avoir inspecté le code ou les preuves qu'il décrit.

**Correction:** introduire un Evidence Collector serveur, en lecture seule et allow-listé, qui produit des artefacts immuables (source, commit SHA, chemin, lignes, hash, date de collecte). Les conclusions doivent référencer des identifiants d'artefacts; absence de preuve = statut « non vérifié ».

### A-02 — Pas de délibération multi-tours ni d'arbitrage
**Sévérité: élevée · Statut: confirmé par le périmètre du worker et du schéma actuel**

Les messages task/handoff sont convertis en missions indépendantes. Le modèle de mission ne conserve pas un graphe de dépendances parent/enfants, des tours, des contributions typées, des réfutations ni un résultat d'arbitrage.

**Conséquence:** la délégation fonctionne, mais elle ne garantit pas une conversation contradictoire ni une synthèse consolidée.

**Correction:** ajouter un modèle durable deliberation/round/participant/contribution/evidence/arbitration, avec profondeur, nombre de tours et budget bornés; l'arbitre doit être distinct des agents contributeurs.

### A-03 — Contrat de sortie trop générique pour un audit
**Sévérité: élevée · Statut: confirmé dans le schéma de sortie du worker**

Le résultat actuel comporte summary, analysis, deliverables, risks, next_steps et assumptions. Il ne force pas les champs preuve, source, portée, confiance, contre-argument, réponse, statut de vérification ni niveau de risque justifié.

**Correction:** versionner des schémas par type de mission. Pour audit: constat, catégorie, sévérité, probabilité, impact, justification, preuve(s), limites, recommandation, responsable, critère de clôture et statut de vérification.

### A-04 — Événements dits append-only sans verrouillage SQL démontré
**Sévérité: moyenne · Statut: à confirmer sur l'ensemble des privilèges effectifs**

La migration décrit `afe_agent_events` comme un journal append-only, mais accorde `ALL` à `service_role`. Ce rôle peut donc techniquement modifier/supprimer les lignes selon les privilèges Postgres. Aucun trigger d'immutabilité n'apparaît dans la migration P0 consultée.

**Correction:** révoquer UPDATE/DELETE sur la table pour les rôles applicatifs, n'autoriser que INSERT/SELECT côté service_role selon les besoins, et ajouter un trigger interdisant UPDATE/DELETE; prévoir une procédure contrôlée de rétention hors journal opérationnel.

### A-05 — Tests de sécurité et de concurrence insuffisants
**Sévérité: élevée · Statut: confirmé dans les tests consultés**

Les tests ciblés vérifient essentiellement des motifs dans le code et les migrations. Ils ne simulent pas deux workers concurrents, l'expiration/reprise d'un lease, un stale token, un accès inter-workspaces réel, une approbation concurrente ou une panne fournisseur.

**Correction:** tests d'intégration sur base Supabase isolée et tests worker avec fetch/provider injectables; ajouter scénarios de concurrence et de reprise.

### A-06 — Couverture d'observabilité à enrichir
**Sévérité: moyenne · Statut: confirmé par le schéma de résultat et les parcours consultés**

Les événements de mission sont présents, mais le parcours de génération ne journalise pas systématiquement fournisseur/modèle/version de prompt, durée, consommation, correlation id, hash de résultat et provenance des sources.

**Correction:** enregistrer une trace d'exécution structurée sans secrets ni données personnelles inutiles.

### A-07 — Cron de production et exécution Preview
**Sévérité: moyenne · Statut: confirmé par la configuration et la documentation du dépôt**

Le Cron est défini dans `vercel.json`, mais le dépôt précise que Vercel Cron est actif sur Production seulement. Le test Preview doit donc rester manuel et authentifié.

**Correction:** conserver cette séparation; ne pas activer de cron de Production pour valider la fonctionnalité. Utiliser l'action Preview admin et des tests CI pour les scénarios automatiques.

## 4. Points positifs à préserver

- Frontière d'autorisation par workspace.
- RLS et révocation des accès directs du navigateur aux tables agents.
- Secret de worker côté serveur uniquement.
- Claim atomique avec `SKIP LOCKED`, lease et fencing token.
- Retry borné.
- Idempotence des handoffs.
- Approbation humaine et blocage du worker sur approbation pending.
- Absence d'adaptateurs d'effets externes privilégiés: conserver le refus par défaut.

## 5. Plan de remédiation ordonné

### Chantier A — Audit avec preuves
1. Evidence Collector en lecture seule (Git commit, fichiers, migrations, tests, CI, schéma DB et logs Preview autorisés).
2. Registre d'artefacts immuables et références de lignes/hash.
3. Schéma de constat versionné et règle « pas de preuve, pas de constat confirmé ».
4. Tests d'accès inter-workspaces, concurrence, fencing, retries, crash/restart et approbation.
5. Rapport de couverture: vérifié / partiellement vérifié / non vérifié / hors périmètre.

### Chantier B — Débat multi-tours et arbitrage
1. Graphe de délibération borné: parent, enfants, participants, dépendances.
2. Tours persistants avec contributions typées: position, objection, réfutation, revue de preuve, révision.
3. Transmission des preuves et des réserves entre agents.
4. Arbitre distinct, avec justification de chaque décision et conservation des désaccords.
5. Approbation humaine pour les décisions sensibles; aucun consensus de modèles n'est une preuve de vérité.

### Chantier C — Gouvernance et livraison
1. Journal d'événements réellement immuable.
2. Traçabilité du modèle, prompt, usage, durée et artefacts.
3. Tests E2E Preview connectés et observabilité.
4. CI obligatoire; PR reste draft jusqu'à validation.
5. Aucune migration Production, aucun déploiement Production, aucun merge vers main sans autorisation distincte.

## 6. Critères d'acceptation

- Chaque constat d'audit est relié à au moins une preuve horodatée, versionnée et vérifiable, ou explicitement marqué non vérifié.
- Un agent ne peut ni écrire ni supprimer les preuves sources.
- Chaque tour et contribution est idempotent, lié au workspace et traçable.
- Les cycles et la récursion sont bloqués par profondeur et budget maximum.
- L'arbitre ne peut pas effacer les désaccords non résolus.
- Un humain autorisé décide des actions sensibles.
- Tous les tests d'intégration et E2E Preview passent.
- Production reste strictement inchangée.

## 7. Limites de cet audit

Cet audit porte sur les fichiers du dépôt et les migrations déclarées dans la branche. Il ne certifie pas la configuration effective du projet Vercel, les secrets, les journaux de Production, les données de Production, ni l'état réel de la base Production. Les résultats d'agents communiqués par l'utilisateur sont des éléments de test fonctionnel, pas des preuves d'audit du code.
