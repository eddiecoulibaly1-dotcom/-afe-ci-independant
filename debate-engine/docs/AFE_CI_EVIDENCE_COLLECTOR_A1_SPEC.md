# AFE-CI — Lot A1 : Evidence Collector et registre de preuves

Statut : spécification d'implémentation — branche de développement uniquement
Branche cible : feature/autonomous-organization-v1
Dépendance : audit technique du 2026-11-06
Règle absolue : aucune lecture de Production, aucune écriture sur les sources auditées, aucune migration ou livraison Production.

## 1. Objectif

Donner aux agents d'audit un mécanisme serveur, déterministe et en lecture seule, qui collecte des éléments techniques vérifiables avant toute conclusion. Une conclusion sans preuve recevra le statut `unverified` et ne pourra pas être présentée comme un fait confirmé.

## 2. Sources autorisées — première version

La V1 du collecteur se limite aux sources explicitement sélectionnées et versionnées :

- Dépôt GitHub et branche/commit de développement autorisés.
- Fichiers du dépôt, avec plages de lignes.
- Migrations SQL versionnées du dépôt.
- Tests automatisés et résultats CI associés au commit.
- Métadonnées de commit et de comparaison.
- Logs Preview explicitement accessibles et fournis par une intégration autorisée.

Exclusions par défaut : Production, secrets, variables d'environnement, données personnelles, bases de données réelles, systèmes externes non autorisés, fichiers hors allow-list.

## 3. Modèle d'artefact

Chaque preuve persistée doit respecter un schéma versionné :

```ts
type EvidenceArtifactV1 = {
  id: string;
  workspaceId: string;
  deliberationId?: string;
  sourceKind: "github_file" | "github_commit" | "migration" | "test_result" | "ci_run" | "preview_log";
  sourceUri: string;
  repository?: string;
  ref?: string;
  commitSha?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  contentSha256: string;
  collectedAt: string;
  collectorVersion: "1.0.0";
  accessMode: "read_only";
  verification: "verified" | "partial" | "unverified";
  excerpt?: string;
  metadata: Record<string, string | number | boolean | null>;
};
```

Règles :
- Hash calculé sur le contenu canonique effectivement collecté.
- Les lignes et le commit doivent permettre de retrouver la source.
- Les extraits sont bornés et expurgés des secrets.
- L'URI est descriptive, jamais une autorisation d'accès.
- Aucun secret ni contenu sensible ne doit être copié dans le registre.
- L'artefact est append-only dans le modèle applicatif; une correction crée un nouvel artefact.

## 4. Contrat du constat d'audit

```ts
type AuditFindingV1 = {
  id: string;
  title: string;
  statement: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  rationale: string;
  evidenceIds: string[];
  verification: "verified" | "partially_verified" | "unverified" | "out_of_scope";
  limitations: string[];
  counterArguments: string[];
  recommendation: string;
  ownerRole?: string;
  closureCriteria: string[];
};
```

Invariants :
- `verified` exige au moins un artefact pertinent et résolvable.
- `partially_verified` exige l'explication explicite de ce qui manque.
- `unverified` ne peut pas être promu en constat confirmé par simple consensus d'agents.
- Les niveaux de probabilité et d'impact doivent avoir une justification textuelle et une matrice versionnée.
- Les désaccords et réserves sont conservés.

## 5. Architecture proposée

1. `evidence-collector.ts` : orchestration en lecture seule et allow-list.
2. `evidence-sources/github.ts` : lecture de commits, fichiers et lignes d'une ref explicite.
3. `evidence-sources/ci.ts` : métadonnées des workflows et résultats de tests.
4. `evidence-sources/preview.ts` : interface désactivée par défaut, activable uniquement avec une autorisation Preview dédiée.
5. `evidence-schema.ts` : validation runtime des artefacts et constats.
6. `evidence-registry.ts` : persistance workspace-scoped et idempotente.
7. `evidence-policy.ts` : allow-list, quotas, taille maximale, redaction et interdiction Production.
8. Tests unitaires et intégration isolée.

Le collecteur ne reçoit jamais de clé de déploiement Production. Les accès sont limités à une identité de lecture du dépôt de développement. Les agents ne choisissent pas librement des URL arbitraires : les connecteurs et ressources sont validés par politique serveur.

## 6. Intégration au worker

Avant l'appel au modèle :
- Identifier le type de mission et le périmètre de collecte autorisé.
- Collecter les preuves déterministes nécessaires.
- Attacher au contexte du modèle uniquement les artefacts autorisés et leurs identifiants.
- Exiger que le résultat référence les identifiants d'artefacts.
- Valider le JSON de sortie avant persistance.
- Rejeter ou déclasser toute affirmation factuelle dépourvue de preuve.
- Journaliser le modèle, la version de prompt, le commit audité, les identifiants de preuves, la durée et l'usage sans secrets.

Une mission non-audit ne déclenche pas automatiquement une collecte générale.

## 7. Sécurité et immutabilité

- Aucun accès réseau arbitraire depuis le collecteur.
- Allow-list de dépôt, branche et chemins.
- Taille maximale par fichier et par collecte.
- Pagination, délais et quotas stricts.
- Redaction des clés, tokens, mots de passe et valeurs d'environnement.
- Vérification du commit SHA avant lecture et conservation du SHA dans chaque artefact.
- Isolation stricte par workspace.
- Aucune fonction d'écriture Git, SQL ou Vercel dans le collecteur.
- Le registre d'artefacts n'est pas considéré inviolable tant que les privilèges SQL et triggers n'ont pas été testés en intégration.

## 8. Tests d'acceptation A1

1. Lecture d'un fichier de la branche autorisée et conservation du commit, des lignes et du hash.
2. Refus d'une branche ou d'un dépôt non allow-listé.
3. Refus de toute source Production.
4. Refus d'une URL arbitraire et des chemins traversants.
5. Redaction d'un faux secret de test avant persistance.
6. Relecture du même contenu : même hash et comportement idempotent.
7. Changement de contenu : nouvel artefact, ancien conservé.
8. Constat vérifié sans evidenceId : rejet.
9. Constat non vérifié sans preuve : accepté avec réserves.
10. Tentative d'accès à un artefact d'un autre workspace : refus.
11. Quota et taille dépassés : arrêt propre et journalisé.
12. Panne GitHub/CI : statut partiel ou non vérifié, jamais une réussite inventée.

## 9. Dépendances avant codage

- Confirmer les tables et contraintes actuellement présentes sur la branche.
- Vérifier les conventions de validation runtime et de tests du dépôt.
- Déterminer si le registre doit réutiliser une table existante ou une migration dédiée.
- Ajouter une migration uniquement pour l'environnement de test isolé après revue du SQL.
- Ajouter les routes/API uniquement après définition des rôles et permissions.

## 10. Ordre de réalisation

A1.1 Contrats de types et validation.
A1.2 Collecteur GitHub en lecture seule.
A1.3 Registre d'artefacts et idempotence.
A1.4 Contrat de constat d'audit et liaison preuve/constat.
A1.5 Intégration worker derrière un feature flag désactivé par défaut.
A1.6 Tests unitaires, SQL et intégration Preview.
A1.7 Revue indépendante Gouvernance & Conformité.

## 11. Porte de sortie

Le lot A1 ne sera déclaré terminé que si les tests d'acceptation passent, si les preuves peuvent être retrouvées à partir de leurs références, si les tentatives hors périmètre sont bloquées et si aucune ressource Production n'a été appelée. Le lot B (débat multi-tours) ne doit consommer que des artefacts A1 validés ou explicitement marqués non vérifiés.

Aucun merge, promotion ou déploiement Production n'est inclus dans ce lot.
