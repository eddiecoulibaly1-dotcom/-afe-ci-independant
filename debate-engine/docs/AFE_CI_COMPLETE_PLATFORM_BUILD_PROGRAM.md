# AFE-CI — Programme de construction intégrale de la plateforme

Version: 1.0
Date: 2026-11-07
Branche de programme: `build/afe-ci-complete-platform`
Base de travail: `fix/agent-lifecycle-atomic-audit-p0`
Référence de produit: `AFE_CI_DEBATE_ENGINE_V2_2_TECHNICAL_SPEC.md`, `AFE_CI_DEBATE_ENGINE_V2_BLUEPRINT.md`, `AFE_CI_AUTONOMOUS_ORGANIZATION_V1_ARCHITECTURE.md` et audit global du 2026-11-06.

## 1. Mandat

Construire AFE-CI comme une plateforme intégrée complète, et non comme une juxtaposition de prototypes. Le système doit couvrir le débat contradictoire, l'intelligence décisionnelle, les preuves, les scénarios, le risque, les rapports, les espaces collaboratifs, la gouvernance et l'organisation autonome multi-agents.

La présente branche de programme consolide les correctifs P0 du cycle de vie des agents sans les fusionner dans la branche de référence. Le programme se déroule sur des branches de développement et des environnements Preview/Test uniquement.

## 2. Références et règles de conservation

- Préserver le commit de référence historique V1.0.7: `8b542f5ea3db0d505ec25ec8972740d9b634bfb7`.
- Préserver `main`, `baseline/v1.0.7`, `feature/autonomous-organization-v1` et la branche de livraison utilisateur sans réécriture d'historique.
- Étendre les modules existants après audit; ne pas remplacer aveuglément le moteur, les prompts, les contrats ou le stockage.
- Toute évolution de schéma est additive, versionnée et vérifiée sur `afe-ci-test` ou une base jetable.
- Aucune migration, aucun secret, aucun déploiement et aucune donnée de Production ne sont touchés par ce programme.
- Les fonctionnalités externes, financières, juridiques, de permission et de déploiement restent refusées par défaut et soumises à approbation humaine explicite.
- Aucun module n'est déclaré terminé sans preuve de test correspondant.

## 3. Architecture produit cible

1. **Debate Engine** — débat multi-agents, rôles distincts, tours adaptatifs, objections, réfutations, révisions, convergence et arbitrage indépendant.
2. **Evidence Intelligence** — découverte de sources autorisées, collecte, registre, intégrité, provenance, pertinence, support/contradiction, couverture et anti-duplication.
3. **Decision Lab** — cadrage des décisions, critères, hypothèses, options, scénarios, simulations, sensibilité et résultats.
4. **Risk & Feasibility Intelligence** — risques inhérents/résiduels, probabilité, impact, contrôles, faisabilité, coûts, limites et confiance probatoire distincte.
5. **Team & Governance** — workspaces, membres, rôles, invitations, documents, commentaires, validations, délégations, notifications et audit.
6. **Autonomous Organization** — registre d'agents, cycle de vie, outils autorisés, missions durables, étapes, leases, reprise, mémoire, messages, approbations, orchestration et supervision.
7. **Reporting & Knowledge** — rapports versionnés, exports, bibliothèque de décisions, mémoire stratégique validée et suivi des recommandations.
8. **Platform Operations** — authentification, isolation multi-tenant, politiques d'accès, observabilité, quotas, feature flags, CI, sauvegarde et procédures de reprise.

## 4. État de départ connu — à confirmer par les tests

Les sources de référence décrivent déjà des composants présents: moteur Architecte/Red Team/Arbitre, preuves, arbitrage, routage, risques, scénarios, scoring, reporting, stockage, authentification, espaces de travail, modules de gouvernance, agents, missions persistantes, mémoire proposée, délégations, approbations et worker serveur.

Les limites explicitement documentées qui doivent être fermées:
- délégation actuelle essentiellement unidirectionnelle;
- absence de graphe parent/enfants complet avec dépendances, état agrégé et synthèse;
- worker autonome actuel limité à une analyse structurée, sans boucle d'outils autorisés;
- absence d'intégration complète entre missions, délibérations, preuves, constats, scénarios, arbitrage et rapport;
- preuve collectée/hashée non équivalente à une preuve qui soutient sémantiquement un constat;
- normalisation/déduplication des constats à compléter;
- contrôle de complétude et arbitrage exhaustif à renforcer;
- expérience de rapport et exports à rendre cohérente et complète;
- tests réels multi-workers, crash/reprise, fournisseur, workspace isolation et parcours complet à exécuter;
- exécution Cron automatique non active en Preview; invocation manuelle authentifiée requise pour les essais;
- gestion du cycle de vie et journalisation P0 nouvellement corrigées, avec migration appliquée sur TEST et tests transactionnels ciblés.

La présence d'un fichier, d'une route ou d'un test unitaire ne prouve pas qu'une capacité est complète.

## 5. Lots de construction et critères de sortie

### Lot A — Fondations et contrats
- Inventorier toutes les routes, modules, tables, migrations, permissions et composants UI.
- Formaliser les contrats versionnés Decision Case, Evidence, Finding, Scenario, Risk, Contribution, Arbitration, Approval, Mission, Run, Step, Tool Grant et Report.
- Documenter les transitions de chaque entité, invariants, erreurs, quotas, idempotence et ownership.
- Détecter les écarts entre migrations Git et schéma réel de TEST.
- Sortie: registre de couverture fichier/fonctionnalité/API/SQL/test, contrats validés par tests, aucune régression baseline.

### Lot B — Debate Engine complet
- Participants explicitement distincts: deux positions indépendantes minimum et arbitre indépendant.
- Planification des tours, limites de coût/temps/tokens, reprise des contributions manquantes, idempotence et détection des répétitions.
- Objections, contre-preuves, réfutations, révisions et désaccords non résolus conservés.
- Normalisation stricte des sorties modèle et rejet des références inconnues.
- Sortie: débat réel de bout en bout avec plusieurs tours, preuve de l'indépendance de l'arbitre et rapport reproductible.

### Lot C — Evidence Intelligence
- Découverte et collecte limitée à des sources autorisées et allow-listées.
- Artefacts immuables avec source, ref, commit, chemin, plage, hash, date et collecteur.
- Évaluations séparées: provenance/intégrité, pertinence, soutien/contradiction/contexte.
- Couverture des sources consultées, inaccessibles et exclues.
- Déduplication idempotente et graphe de liens preuve-constat.
- Sortie: aucune affirmation confirmée sur la seule base d'une source simplement lue ou hachée.

### Lot D — Decision Lab, simulation et risques
- Decision Case avec objectif, périmètre, critères, contraintes, options et hypothèses.
- Scénarios, drivers, horizons, sensibilités, hypothèses alternatives et signaux.
- Calcul quantitatif traçable; aucune valeur manquante inventée.
- Risques inhérents et résiduels, probabilité, impact, contrôle, faisabilité et confiance probatoire séparés.
- Sortie: décisions et scénarios explicables, reproductibles et liés à leurs preuves.

### Lot E — Gouvernance collaborative
- Isolation stricte workspace et rôles viewer/editor/admin/owner.
- Membres, invitations, révocation, espaces, documents privés, commentaires et validations.
- Notifications, audit append-only et export d'audit.
- Approbation par personne distincte de l'auteur pour les actes sensibles; hash de payload et expiration.
- Sortie: tests négatifs cross-workspace et matrice de permissions exhaustive.

### Lot F — Autonomous Organization
- Catalogue de départ des six départements: Stratégie & Développement; Finance & Investissements; Gouvernance & Conformité; Technologie & Ingénierie; Risques & Contrôle; Recherche & Prospective.
- Cycle de vie atomique et journal fiable; configuration versionnée; outils allow-listés et grants administrés.
- Missions persistantes, étapes idempotentes, leases, fencing, retries bornés, checkpoint et reprise.
- Orchestration parent/enfants, dépendances, prévention des cycles, plafonds de profondeur et budgets.
- Messages task/handoff/response/review/synthesis; réponse, revue indépendante, agrégation et synthèse.
- Mémoire privée/proposée/validée/rejetée; aucune mémoire partagée sans validation.
- Approbations liées au payload, acteur, périmètre, expiration et décision à usage unique.
- Worker serveur indépendant du navigateur; fermeture téléphone/onglet sans interrompre une mission.
- Sortie: tests de concurrence, reprise, stale lease, idempotence, approbation et synthèse multi-agent.

### Lot G — Reporting, documents et connaissance
- Rapport exécutif et détaillé avec périmètre, couverture, preuves, constats, risques, dissent, limites, décisions et recommandations.
- Copie, export Markdown, Word et PDF avec formats explicitement vérifiés.
- Historique des versions, hash du rapport approuvé, export sans fuite de données.
- Mémoire stratégique indexée, consultable et validée.
- Sortie: exports ouverts et comparés au rapport écran; intégrité des versions et droits testés.

### Lot H — Interface unifiée
- Navigation cohérente entre Débats, Decision Lab, Evidence, Risques, Rapports, Espaces, Agents, Missions, Délégations, Approbations, Documents et Audit.
- États de chargement, erreurs, vide, succès, progression et reprise explicites.
- Actions sensibles confirmées, accessibles, désactivées si interdites.
- Responsive mobile/desktop et lecture audio manuelle; lecture audio maintenue lorsque l'écran se verrouille si l'environnement technique le permet et si le test confirme ce comportement.
- Sortie: parcours UI/API testés sur Preview avec session authentifiée.

### Lot I — Sécurité et exploitation
- Revue exhaustive RLS, grants SQL, RPC, fonctions SECURITY DEFINER/INVOKER, secrets, CORS, SSRF, XSS, CSRF, rate limits et journalisation.
- Vérification des 13 tables RLS sans policy signalées, chacune justifiée par un accès server-only explicite ou corrigée par politique minimale.
- Tests d'isolation, d'escalade de privilèges, de falsification d'acteur, d'accès direct et de fuite de secrets.
- Observabilité corrélée: request, mission, run, step, agent, provider, coût, durée et événements.
- Sortie: rapport de sécurité sans finding P0/P1 ouvert avant réception.

## 6. Matrice d'acceptation globale

- Baseline V1.0.7 préservée et tests de non-régression verts.
- Tous les lots A à I ont une matrice de traçabilité exigences → code → test → preuve.
- CI: npm ci, TypeScript strict, lint si configuré, tests unitaires, intégration et contrôles sécurité.
- E2E: création d'un Decision Case → débat contradictoire → collecte/évaluation de preuves → constats → scénarios/risques → arbitrage → approbation → rapport → exports.
- E2E autonome: mission parent → agents enfants → réponses → revue indépendante → synthèse parent → mémoire proposée → validation humaine.
- E2E reprise: fermer le navigateur, tuer un worker simulé, expirer lease, relancer et vérifier absence de perte/doublon.
- Tests négatifs cross-workspace et permissions.
- Preview READY sur le commit exact testé.
- Rapport final listant résultats réussis, échoués, non exécutés, limitations et coûts estimés.

## 7. Ordre d'exécution

1. Cartographie complète et audit de couverture.
2. Contrats et fondations.
3. Débat + Evidence Intelligence.
4. Decision Lab + risques + simulation.
5. Gouvernance et collaboration.
6. Orchestration autonome multi-agents.
7. Reporting, exports et mémoire stratégique.
8. Interface unifiée et accessibilité.
9. Hardening sécurité et exploitation.
10. Campagne globale de tests et corrections.
11. Livraison Preview documentée.

L'ordre peut être ajusté selon les dépendances techniques découvertes, mais aucune exigence du cahier des charges ne peut être abandonnée silencieusement.

## 8. Politique de livraison

- Travailler exclusivement dans `build/afe-ci-complete-platform` ou ses branches enfants.
- Conserver les PR en brouillon jusqu'à ce que leurs critères soient prouvés.
- Les migrations sont d'abord testées sur base jetable/TEST, avec vérification des définitions réelles et des effets.
- Ne pas activer de secrets, intégrations externes, paiements, outils privilégiés ou actions irréversibles sans contrat, garde-fous et tests.
- Aucun merge dans `main`, aucune migration Production, aucun déploiement Production sans autorisation distincte.
- La réception finale ne sera annoncée qu'après preuves d'exécution des scénarios E2E.

## 9. Registre de progression initial

| Lot | État initial |
|---|---|
| A — Fondations/contrats | Inventaire documentaire commencé; traçabilité complète à produire |
| B — Debate Engine | Noyau existant; complétude E2E à démontrer |
| C — Evidence Intelligence | Modules présents; qualification sémantique et idempotence à fermer |
| D — Decision Lab/risques | Modules présents; intégration bout en bout à fermer |
| E — Team & Governance | Socle présent; parcours/permissions à auditer |
| F — Autonomous Organization | P1–P9 partiellement livrés; P10+ orchestration complète à construire |
| G — Reporting/connaissance | Moteur présent; exports et validation E2E à fermer |
| H — Interface unifiée | UI existante; couverture fonctionnelle et responsive à auditer |
| I — Sécurité/exploitation | P0 lifecycle corrigé sur TEST; revue exhaustive restante |

Ce registre doit être mis à jour à chaque livraison avec commit, tests, preuve et limites.
