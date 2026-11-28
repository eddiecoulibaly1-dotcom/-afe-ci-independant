# E11 — Intelligence stratégique & anticipation organisationnelle
Statut: implementation branche development uniquement.

## E11.1 Early Warning
Alertes déterministes et evidence-backed sur dérive échéances, congestion, échecs, alertes et arbitrages. Severity et trigger explicites; aucune alerte n'affirme une causalité prouvée.

## E11.2 Trend & Forecast
Tendance de 5 indicateurs sur snapshots historiques. Horizon 30/60/90 jours. Projection linéaire simple, bornée 0–100, confidence selon profondeur historique. Moins de 3 snapshots: projections indicatives, couverture faible/moyenne.

## E11.3 Capacity & Flow Pressure
Pression de capacité basée sur missions actives, tâches ouvertes et blocages; score 0–100 et bandes low/moderate/high; null si données absentes.

## E11.4 Strategic Risk Register
Risques dérivés des warning triggers, likelihood/impact 1–5, score 1–25, niveau, owner, mitigation, statut. Pas de risque inventé sans signal observé.

## E11.5 Scenario Simulator
Scénarios base, stress et recovery. Hypothèses explicites et impacts indicatifs sur métriques. Comparaison exige au moins deux scénarios. Les simulations n'écrivent pas dans le portefeuille.

## E11.6 Strategic Options & Governance
Options priorisées et conditionnelles, actions, impact, niveau de risque. Elles restent des propositions; aucune exécution automatique. Gouvernance indique DG approval required.

API: GET /team/api/workspaces/:workspaceId/coo/strategy?days=30|60|90 ; POST /team/api/workspaces/:workspaceId/coo/strategy/snapshots (snapshot de stratégie); POST /team/api/workspaces/:workspaceId/coo/strategy/proposals avec optionId transforme une option conditionnelle en draft E10, idempotent, soumise au workflow DG (submit/approve/reject/implement/evaluate). Auth workspace; editor requis pour snapshot; persistence test only.