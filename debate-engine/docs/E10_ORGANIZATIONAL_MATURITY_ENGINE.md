# E10 — Intelligence de maturité organisationnelle (E10.1–E10.6)

**Statut : implémentation sur branche de développement uniquement.** Aucun déploiement Production ni migration distante n'est effectué dans ce chantier.

## E10.1 Health & Performance Engine
Calcul déterministe à partir du portefeuille COO : volumes, missions actives/terminées/échouées/bloquées/en retard, tâches ouvertes/terminées/bloquées/en retard, alertes, approvals en attente, ratios et performance par direction. Les dénominateurs nuls retournent `null`; un portefeuille sans mission/tâche retourne `insufficient_data` (score de maturité null), et non une note arbitraire. Le score 0–100 est un indicateur de tendance et ne constitue pas une certification.

Axes : delivery, reliability, flow, quality, governance. Bandes : advanced ≥85, managed ≥70, developing ≥50, fragile <50.

## E10.2 Root Cause Intelligence
Règles explicites, evidence-backed, déclenchées par seuils : retard/planning, dépendances, affectation organisationnelle, qualité/échecs, arbitrages en attente, capacité et alertes critiques. Chaque constat contient identifiant stable, catégorie, éléments de preuve, confidence (0–1), action recommandée et impact. Il ne prétend pas prouver une cause : « cause probable » et confiance sont exposées.

## E10.3 Organizational Learning
Mémoire JSONB workspace-scoped, normalisation, validation confidence, déduplication d'identifiants de preuve et agrégation des apprentissages success/mixed/failure/unknown. Les observations sont traçables par preuves; la mémoire ne modifie pas automatiquement les règles d'exécution.

## E10.4 Improvement Proposal Engine
Génère des propositions draft à partir des root causes. Identifiants déterministes, actions, impact et niveau de risque. La génération est idempotente par workspace + proposal_id. Aucune proposition n'est exécutée automatiquement.

## E10.5 DG Governance
Cycle : draft → submitted → approved/rejected → implemented → evaluated. Approve/reject réservé à l'identité DG configurée (Owner par défaut); auteur ne peut arbitrer sa propre proposition. Implement/evaluate/submit requièrent rôle editor/admin/owner. Événements d'audit append-only; la proposition conserve son historique de statut.

## E10.6 Controlled Evolution & Evaluation
L'implémentation ne peut être marquée qu'après approbation DG. Évaluation obligatoire après implémentation avec baseline et mesure après; calcul delta et outcome improved/unchanged/worse. Le module mesure une amélioration, il ne change pas automatiquement les agents, prompts, permissions ou règles de production.

## API
- `GET /team/api/workspaces/:workspaceId/coo/maturity` — health, causes, memory agrégée, propositions et snapshots.
- `POST .../maturity/snapshots` — snapshot health + root causes, idempotent à timestamp identique.
- `POST .../maturity/learning` — ajoute un learning item.
- `POST .../maturity/proposals` — génère draft proposals, sans dispatch.
- `POST .../maturity/proposals/:proposalId/submit`
- `POST .../maturity/proposals/:proposalId/approve` / `reject`
- `POST .../maturity/proposals/:proposalId/implement`
- `POST .../maturity/proposals/:proposalId/evaluate` — JSON `{baseline,after,measuredAt?}`.

Toutes les routes passent par authentication et contrôle d'appartenance workspace. Les données de persistance sont server-side; RLS activée et accès client direct révoqué. Les opérations d'écriture nécessitent editor sauf arbitrage DG. Le journal d'événements de proposition est immuable.

## UI
Page `/coo/maturity`, accessible depuis le COO. Réutilise la session existante et le choix workspace. Affiche score/axes, portefeuille, direction, causes racines, mémoire, propositions et actions gouvernées.

## Validation
Tests dédiés couvrent : données vides, métriques/rates, découpage par direction, causes avec preuves, normalisation/agrégation memory, génération proposals, auto-arbitrage interdit, DG gating, implémentation contrôlée, évaluation baseline/after et tests statiques de migration/API. Exécution typecheck + suite complète + CI à consigner dans le rapport E10 final.

## Sécurité / limites
- Branche `feature/autonomous-organization-v1` uniquement.
- Pas de migration Supabase exécutée.
- Pas de Production deploy.
- Pas d'auto-modification de l'organisation/agents; toute proposition reste gouvernée.
- Maturity scores ne doivent pas être présentés comme une preuve causale ou une certification.
