# AFE-CI — Audit global de la plateforme et plan d'intégration

**Date :** 2026-11-06  
**Périmètre :** branche `feature/autonomous-organization-v1` uniquement  
**Statut :** audit initial réalisé ; intégration Preview synchronisée ; aucune promotion Production.

## 1. Décision d'architecture

AFE-CI doit rester une plateforme unique, organisée autour de quatre domaines intégrés :

1. **Debate Engine** — délibération contradictoire, objections, réfutation et arbitrage.
2. **Decision Lab** — scénarios, preuves, critères, risques et rapport de décision.
3. **Team & Governance** — espaces, rôles, documents, audit, validations et responsabilités.
4. **Autonomous Organization** — agents spécialisés, missions durables, délégations, mémoire, approbations et supervision.

Le workspace est la frontière d'autorisation. Les interfaces ne font qu'orchestrer les demandes ; le traitement et les permissions restent côté serveur.

## 2. État constaté

### Déjà présent dans la branche

- Modèle de données des agents, grants d'outils, missions, exécutions, étapes, événements, messages, mémoire et approbations.
- API workspace-scoped avec vérification serveur des rôles.
- Intake de missions persistantes avec idempotence.
- Worker serveur avec claim atomique, lease/fencing token, appel de modèle, résultat structuré et retries bornés.
- Délégation durable task/handoff avec création idempotente d'une mission destinataire.
- Cycle d'approbation qui suspend/reprend ou rejette une mission.
- Vues Team & Governance pour Agents IA, Missions, Délégations et Approbations IA.
- Normalisation défensive des collections API avant affichage.
- Tests ciblés du routage, des contrôles d'API, du worker et de l'interface.

### Limites fonctionnelles encore ouvertes

- La délégation est actuellement un transfert durable à sens unique ; elle ne réalise pas encore une conversation complète avec réponse, revue et synthèse automatiques.
- Il n'existe pas encore de graphe d'orchestration parent/enfants avec dépendances, état agrégé et reprise contrôlée du parent.
- Le worker produit une analyse structurée par mission ; il ne réalise pas encore un débat contradictoire multi-agents ni un consensus documenté.
- Les résultats des agents ne sont pas encore reliés de bout en bout aux objets Débat et Decision Lab (claims, preuves, réfutations, scénarios, arbitrage et rapport).
- Les outils privilégiés et actions externes ne sont pas implémentés ; ils doivent rester refusés par défaut.
- Le fonctionnement automatique Cron est limité aux déploiements Production Vercel. En Preview, le worker nécessite une invocation manuelle authentifiée.
- Les tests unitaires et statiques existants ne remplacent pas les essais réels multi-workers, de reprise après interruption, d'expiration de lease et de délégation avec fournisseurs IA.

## 3. Diagnostic du défaut visible dans les captures

La page Team & Governance capturée affichait une ancienne version de l'interface : absence des onglets Agents IA / Missions et rendu de collections par des appels directs à `.map`.

La branche de développement contenait déjà une version plus récente :
- onglets Agents IA, Missions, Délégations et Approbations IA ;
- normalisation `Array.isArray(value) ? value : []` ;
- test `team-autonomous-ui.test.ts`.

La comparaison Git a établi que le déploiement Preview précédemment partagé était en retard de 10 commits par rapport à la tête de branche. Un nouveau déploiement Preview a été construit depuis la branche actuelle, commit `c3b061d5043d15715546e7c8970065df885d06cb`, puis vérifié en HTTP : la page servie contient bien les quatre onglets et le garde-fou des collections. Cette vérification confirme le contenu HTML servi, pas encore le parcours connecté dans le navigateur mobile.

## 4. Plan d'implémentation ordonné

### P10 — Orchestration multi-agents durable
- Modéliser les relations parent/enfant et dépendances de missions.
- Définir les types de messages task, handoff, response, review et synthesis.
- Implémenter la réponse du destinataire, la revue indépendante et la clôture agrégée.
- Prévenir les cycles, doublons, délégations récursives non bornées et dépassements de budget.
- Ajouter un état explicite de mission parent : waiting_children, ready_to_synthesize, completed ou failed.

### P11 — Délibération contradictoire multi-agents
- Transformer un objectif en plan de travail borné.
- Affecter des rôles distincts : architecte, red team, expert métier, contrôleur de preuves et arbitre.
- Séparer assertions, hypothèses, objections, preuves et réfutations.
- Exiger une synthèse qui conserve les désaccords non résolus.
- Ne jamais présenter un consensus de modèles comme une preuve de vérité.

### P12 — Connexion Debate Engine / Decision Lab / Governance
- Attacher les missions, livrables, événements et références de preuve à un cas de décision.
- Convertir les livrables validés en propositions de claims, risques et scénarios, sans publication implicite.
- Soumettre les décisions à l'approbation humaine selon leur criticité.
- Conserver l'auteur, l'agent, le modèle, la version des instructions et la provenance de chaque livrable.

### P13 — Supervision et expérience utilisateur
- Tableau de bord unifié : agents, files, missions, enfants, exécutions, erreurs, coûts, délais et approbations.
- Afficher les détails d'une mission, ses événements et sa chaîne de délégation.
- Améliorer la navigation mobile, les états de chargement, erreurs API et actions de reprise.
- Rendre les rôles et droits visibles dans l'interface sans exposer les secrets.

### P14 — Validation et sécurité
- Tests d'accès inter-workspaces pour chaque route et ressource liée.
- Tests de concurrence de claim, fencing token, retries, crash/restart et idempotence.
- Tests de cycle et de profondeur maximale de délégation.
- Tests d'approbation, auto-approbation interdite et payload immuable.
- Tests E2E connectés avec fournisseurs IA et worker Preview authentifié.
- Revue des migrations, RLS, privilèges SQL, secrets, quotas, journaux et observabilité.

## 5. Garde-fous de livraison

- Toutes les modifications restent sur `feature/autonomous-organization-v1` ou une branche de travail dérivée.
- La base de test Supabase reste isolée.
- Aucun secret n'est écrit dans le dépôt ou dans le navigateur.
- Pas de merge vers `main`, pas de migration Production, pas de déploiement Production sans autorisation distincte.
- Les fonctionnalités non testées en conditions réelles doivent rester explicitement marquées comme non validées.

## 6. Prochaine unité de travail

Commencer par P10 : définir et tester le cycle complet parent → délégation → mission enfant → réponse → revue → synthèse parent. Cette unité est le socle requis avant d'annoncer une véritable organisation multi-agents capable de débattre et de converger.
