# AFE-CI Intelligence Organization — Référentiel directeur organisationnel

**Version :** 1.0.0  
**Statut :** Référentiel produit et architecture cible adopté pour la suite du développement  
**Date :** 7 novembre 2026  
**Branche de référence de construction :** `build/afe-ci-complete-platform`  
**Compatibilité historique :** V1.0.7 préservée  
**Environnement :** développement / Preview / `afe-ci-test` uniquement

> Ce document devient le référentiel directeur de l'architecture produit, fonctionnelle, UX et technique d'AFE-CI. Il remplace le positionnement « débat contradictoire comme expérience principale » par celui d'une organisation intelligente. Il ne supprime pas les spécifications historiques : il les repositionne comme capacités spécialisées, sous réserve de compatibilité et d'ADR.

## 1. Décision produit

AFE-CI devient une **organisation intelligente multi-agents** pilotée par un utilisateur humain qui agit comme Président / propriétaire de l'organisation.

L'utilisateur formule un objectif, une question, une étude ou un dossier. Le Directeur général IA qualifie la demande, construit le plan de mission, choisit les directions compétentes, délègue le travail, coordonne les échanges, déclenche les contrôles et remet un rapport consolidé. Les directions disposent de leurs propres bureaux numériques et peuvent mobiliser des agents spécialistes.

Le système ne se limite plus à « question + contexte → débat → réponse ». Le débat contradictoire devient une capacité transversale et activable, appelée **Contradiction Lab**.

### 1.1 Promesse

« Confier une problématique à une organisation d'agents spécialisés qui savent planifier, collaborer, produire, vérifier et rendre compte. »

### 1.2 Principes non négociables

1. L'utilisateur exprime le résultat attendu; il n'a pas à choisir manuellement chaque agent.
2. Le Directeur général orchestre et synthétise; il ne doit pas exécuter seul toutes les analyses spécialisées.
3. Les directions ont des mandats, responsabilités, limites et bureaux identifiables.
4. Les équipes de mission sont composées dynamiquement à partir du catalogue organisationnel; l'organigramme permanent n'impose pas la même équipe à chaque dossier.
5. Un agent peut travailler seul, en équipe, demander une clarification, transmettre un livrable ou contester un résultat.
6. Les conclusions critiques font l'objet d'une revue indépendante; l'auteur ne valide pas seul son propre travail.
7. Le consensus entre agents ne constitue pas une preuve.
8. Les faits, hypothèses, estimations, avis et inconnues restent distingués.
9. Les missions, messages, livrables, décisions et événements sont persistants côté serveur.
10. Aucune action externe, financière, juridique, irréversible ou de Production n'est autorisée implicitement.
11. Les mémoires organisationnelles sont proposées avant d'être partagées/validées.
12. Les coûts, délais, budgets d'exécution et limites de profondeur sont contrôlés.

## 2. Modèle organisationnel

### 2.1 Niveaux hiérarchiques

- **Président / propriétaire humain** : définit la vision, confie les objectifs, consulte l'organisation et valide les décisions réservées. Ce rôle ne doit pas être confondu avec un agent IA.
- **Directeur général IA (CEO / Orchestrateur)** : reçoit les demandes, les qualifie, planifie, sélectionne les directions, délègue, surveille, arbitre les dépendances et consolide les livrables.
- **Directeurs de fonction** : responsables de domaines, organisent les travaux de leur direction, affectent des sous-missions, contrôlent la qualité métier et rendent compte au DG.
- **Agents spécialistes** : exécutent des tâches bornées selon leur spécialité, leurs outils autorisés, leur niveau d'autonomie et leur mandat.
- **Cellules temporaires de mission** : équipes inter-directions constituées pour un dossier précis; elles ne modifient pas nécessairement l'organigramme permanent.

La hiérarchie de mission peut différer de la hiérarchie organisationnelle. Un agent d'une direction peut contribuer à une mission coordonnée par un autre directeur, sans changer de rattachement permanent.

### 2.2 Organigramme initial recommandé

Le catalogue de départ comporte huit directions fonctionnelles. Ce catalogue est une configuration versionnée, pas une affirmation que tous les agents correspondants existent déjà ou sont activés.

| Code | Direction | Mandat principal | Livrables usuels |
|---|---|---|---|
| DG | Direction générale | Orchestration, stratégie de mission, arbitrage et synthèse | Plan de mission, arbitrages, rapport exécutif |
| RES | Recherche & Evidence Intelligence | Recherche, collecte, provenance, vérification et couverture | Dossier de sources, registre de preuves |
| STR | Stratégie & Développement | Diagnostic, options, positionnement, prospective | Analyse stratégique, options et recommandations |
| FIN | Finance & Investissements | Modèles financiers, budgets, coûts, rentabilité et financement | Modèle financier, scénarios, analyse économique |
| COM | Commercial & Marché | Demande, concurrence, clients, prix, canaux et ventes | Étude de marché, plan commercial |
| OPS | Opérations & Exécution | Processus, ressources, capacité, logistique et mise en œuvre | Plan opérationnel, calendrier, ressources |
| RSK | Risques & Faisabilité | Risques, contrôles, contraintes, faisabilité et stress tests | Cartographie, scénarios de risque, plans de mitigation |
| AUD | Audit, Qualité & Gouvernance | Revue indépendante, traçabilité, conformité du processus et qualité | Rapport de revue, réserves et avis indépendant |
| TEC | Technologie & Ingénierie | Architecture, conception, développement, sécurité et tests | Architecture, code, rapport de tests |

DG est la fonction de direction générale et non une direction de métier sélectionnée comme une expertise ordinaire. AUD doit conserver une indépendance de revue par rapport au producteur du livrable. Les fonctions peuvent être regroupées ou spécialisées ultérieurement par décision d'architecture.

### 2.3 Rattachement et délégation

- Un agent a un rattachement organisationnel principal et un mandat versionné.
- Une mission a un coordinateur, un demandeur, un workspace, un objectif, un niveau de risque, un budget et une échéance éventuelle.
- Une affectation de mission est temporaire et peut concerner un agent, une direction ou une cellule multi-directions.
- Les dépendances de mission ne créent pas automatiquement une relation hiérarchique.
- Les enfants sont créés dans le même périmètre workspace que leur parent.
- Les limites de profondeur, de concurrence, de coût et de retries sont appliquées côté serveur.
- Les transitions et délégations sont journalisées et idempotentes.

## 3. Modèle des bureaux numériques

### 3.1 Un bureau par fonction/équipe, une fiche de travail par agent

Chaque direction possède un **bureau de direction**. Le DG possède le **bureau de la Direction générale**. Le Président dispose d'un **espace exécutif humain** distinct.

Chaque agent possède une fiche et un espace de travail personnel logique, mais il n'est pas nécessaire de créer une interface physique complète pour chaque agent. L'espace d'un agent expose son mandat, ses compétences, ses missions, ses livrables, ses échanges, son état, ses limites et son historique autorisé.

Un bureau est une vue de travail contextualisée sur des données persistantes; ce n'est pas un processus d'exécution autonome dans le navigateur.

### 3.2 Contenu standard d'un bureau de direction

1. **Vue d'ensemble** : mandat, responsable, état, indicateurs et activité récente.
2. **Boîte de réception** : missions assignées, handoffs, demandes de clarification, validations et alertes.
3. **Missions & dossiers** : à planifier, en cours, en attente, terminés, échoués ou annulés.
4. **Équipe** : directeur, agents rattachés, compétences, capacités et disponibilité.
5. **Livrables** : rapports, analyses, fichiers, versions, preuves et décisions associées.
6. **Communication** : messages, fils de dossier, demandes de revue et réunions/briefings structurés.
7. **Performance & qualité** : délais, taux de reprise, qualité des livrables, incidents, coûts et charge.
8. **Mandat & gouvernance** : responsabilités, exclusions, outils autorisés, niveaux d'autonomie et délégations.

### 3.3 Bureau du Directeur général

Le DG dispose en plus de :
- tableau de bord global de l'organisation;
- registre de toutes les missions et leurs états;
- planificateur de mission et composition des équipes;
- vue de délégation et de dépendances;
- boîte de réception inter-directions;
- alertes, blocages et demandes d'arbitrage;
- synthèse des rapports et avis indépendants;
- vue coûts/délais/ressources;
- mémoire des décisions validées;
- espace de dialogue avec le Président.

Le DG ne peut ni modifier les preuves sources ni neutraliser une réserve d'audit sans laisser une décision motivée et une trace.

### 3.4 Bureau du Président

Espace humain privilégié :
- soumettre une nouvelle mission;
- consulter le DG et les rapports;
- suivre les dossiers stratégiques;
- ajouter contraintes, documents ou instructions;
- demander une nouvelle analyse, une contradiction ou une revue;
- valider/rejeter les actes qui exigent une approbation humaine;
- consulter l'historique des décisions et les limites signalées.

## 4. Routage des missions et composition dynamique

Le routage suit un protocole explicable :

1. **Intake** : normaliser l'objectif, le périmètre, le contexte fourni, les contraintes, les livrables attendus et les inconnues.
2. **Qualification** : classifier le type de travail (recherche, étude, investissement, stratégie, opération, technologie, audit, débat formel, etc.).
3. **Plan** : décomposer en lots et tâches avec critères d'acceptation, dépendances, échéances et budget.
4. **Sélection** : sélectionner les directions et agents sur la base de capacités/compétences, mandat, autorisations, disponibilité, charge, coût et conflits d'intérêts.
5. **Validation du plan** : vérifier la couverture des compétences, la séparation des tâches et les risques. Demander une clarification à l'utilisateur si une donnée indispensable manque; ne pas bloquer pour les préférences non essentielles.
6. **Délégation** : créer les missions parent/enfants et les dépendances de manière atomique et idempotente.
7. **Exécution** : les agents produisent des résultats et peuvent communiquer ou demander des clarifications.
8. **Confrontation** : déclencher des challenges ciblés ou le Contradiction Lab selon le risque, le désaccord ou la demande.
9. **Revue indépendante** : une fonction AUD ou un réviseur distinct contrôle preuves, logique, calculs, couverture et limites.
10. **Consolidation** : le DG produit une synthèse traçable, distingue faits/estimations/avis/inconnues et rend visibles les désaccords non résolus.
11. **Décision humaine** : l'utilisateur conserve l'autorité sur les actes réservés.
12. **Suivi et mémoire** : suivre les recommandations si demandé; proposer des enseignements à la mémoire, qui ne deviennent partagés qu'après validation.

Le moteur doit pouvoir choisir une équipe réduite pour une question simple et une équipe étendue pour un dossier complexe. Il doit justifier les directions mobilisées et les omissions importantes.

## 5. Contradiction Lab — capacité transversale

Le débat contradictoire reste un sous-système de première classe, mais n'est plus le point d'entrée ni le parcours par défaut.

Trois modes :
- **Challenge intégré** : une direction demande une objection ciblée sur une hypothèse, un calcul ou un livrable.
- **Revue adversariale** : un agent indépendant recherche les faiblesses, contre-exemples et scénarios défavorables.
- **Débat formel** : l'utilisateur ou le DG déclenche un débat structuré avec positions distinctes, réfutations, arbitre indépendant et rapport.

Les débats et objections sont attachés au dossier/mission d'origine et leurs résultats reviennent dans les bureaux concernés. Un consensus n'efface pas les objections ouvertes.

## 6. Architecture fonctionnelle et contrats de domaine

Les objets de domaine recommandés sont :

| Objet | Responsabilité |
|---|---|
| Organization | Conteneur logique de l'organisation |
| OrganizationMembership | Rôle humain dans l'organisation |
| Department | Direction fonctionnelle et mandat |
| Office | Espace de travail d'un responsable/d'une équipe |
| Agent | Collaborateur IA configuré |
| AgentAssignment | Rattachement permanent ou affectation temporaire |
| Capability | Compétence déclarée et versionnée |
| Mandate | Responsabilités, limites et autorisations |
| Mission | Objectif/dossier durable à traiter |
| MissionAssignment | Affectation d'une mission à une direction/agent |
| MissionDependency | Dépendance entre missions |
| MissionMessage | Message, handoff, clarification, revue ou synthèse |
| Artifact | Livrable versionné et traçable |
| Evidence | Preuve/source liée à une affirmation ou un livrable |
| Review | Revue indépendante et ses constats |
| Decision | Décision, auteur, justification et approbation |
| Approval | Autorisation humaine liée à un payload immuable |
| AuditEvent | Journal append-only des actes et transitions |
| KnowledgeItem | Mémoire privée, proposée, validée ou rejetée |
| PerformanceSnapshot | Mesures de qualité, coût, durée et charge |

Ces entités sont des contrats logiques. Elles ne prescrivent pas la création immédiate d'une table pour chacune. L'implémentation doit d'abord inventorier les tables existantes et réutiliser les concepts déjà présents sans confondre leur sémantique.

### 6.1 Séparation des frontières

- **Organisation** : structure stable, directions, bureaux, mandats et rattachements.
- **Mission** : travail temporaire, objectif, plan, affectations et dépendances.
- **Communication** : échanges durables contextualisés à une mission ou à une direction.
- **Artifact** : livrable versionné, auteur, statut, hash et liens de provenance.
- **Governance** : approbations, revues, événements et droits.
- **Runtime** : exécution serveur, steps, leases, checkpoints, retries et budgets.

Ne pas utiliser les messages comme stockage d'artefacts; ne pas utiliser les événements d'audit comme messagerie; ne pas confondre un agent et une direction.

## 7. Architecture UX et navigation

Navigation principale cible :
1. **Accueil / Siège** — résumé exécutif, lancement d'une mission, alertes et dossiers récents.
2. **Organigramme** — arbre interactif Président → DG → directions → équipes → agents.
3. **Bureaux** — espace de travail du DG et de chaque direction; accès aux fiches/espaces des agents.
4. **Missions & dossiers** — liste, vues kanban/chronologie, dépendances, livrables et progression.
5. **Communication interne** — boîte de réception, messages mission-scoped, handoffs et clarifications.
6. **Rapports & connaissance** — livrables, preuves, décisions, archives et mémoire validée.
7. **Contradiction Lab** — challenges, revues adversariales et débats formels.
8. **Pilotage** — performance, coûts, charge, délais, qualité et observabilité.
9. **Administration** — organisation, directions, agents, mandats, rôles, grants et paramètres.

### 7.1 Parcours utilisateur principal

Accueil → « Nouvelle mission » → description libre de l'objectif → plan de mission proposé par le DG → équipe/directions mobilisées visibles → exécution suivie → livrables et revue → rapport consolidé → validation humaine si nécessaire.

L'utilisateur peut entrer directement dans un bureau et lui confier une mission, mais le point d'entrée recommandé reste le DG pour les demandes transversales.

### 7.2 États d'interface obligatoires

Chargement, vide, en cours, en attente d'information, en attente de revue, en attente d'approbation, bloqué, terminé, terminé avec réserves, échoué, annulé, reprise après interruption. La progression affichée doit venir de l'état persistant du serveur, jamais d'un faux pourcentage local.

## 8. Gouvernance, sécurité et limites d'autonomie

- Isolation workspace conservée; les données organisationnelles et missions sont toujours scopeées et contrôlées côté serveur.
- Les rôles humains (owner/admin/editor/viewer) sont distincts des fonctions IA.
- Les directions et agents n'obtiennent aucun privilège par leur seul titre.
- Les grants d'outils sont explicites, minimaux, versionnés et révocables.
- L'agent ne peut pas modifier son mandat, ses grants, son niveau d'autonomie ni son rattachement.
- Les missions inter-directions ne permettent pas de contourner les autorisations du workspace.
- Les approbations humaines sont à usage unique, liées à l'action exacte, au hash du payload, au périmètre, à l'approbateur et à une expiration.
- Les opérations externes, irréversibles, financières, juridiques, de permission et de Production exigent une approbation humaine.
- AUD doit être indépendant de l'agent/auteur du livrable revu.
- Les messages, livrables, revues et décisions sont journalisés avec acteur et corrélation; les secrets ne sont jamais consignés.
- Les politiques RLS, grants SQL, RPC et accès serveur font l'objet de tests négatifs cross-workspace.

## 9. Architecture technique cible

Conserver la pile existante (application TypeScript/Node, Vercel Functions et Supabase Postgres/Auth) tant que les preuves ne justifient pas une migration. Ne pas créer une deuxième application ou une deuxième base pour matérialiser les bureaux.

Le frontend est un **control plane** : navigation, vues, formulaires, lecture des états, interaction humaine. Il n'exécute pas les missions.

Le backend expose des services logiques :
- Organization Catalog & Directory;
- Office Read Model / Dashboard Aggregation;
- Mission Intake & Planning;
- Assignment & Routing;
- Mission Orchestration;
- Messaging & Handoff;
- Artifact & Evidence Registry;
- Review & Contradiction;
- Decision & Approval;
- Knowledge & Performance;
- Audit & Observability.

Le worker durable reste serveur. Les missions doivent survivre à la fermeture du navigateur et à l'arrêt d'un worker. Chaque step doit avoir idempotence, checkpoint, lease et fencing. Les changements de schéma restent additifs, avec migrations versionnées et TEST uniquement.

### 9.1 Modèle d'identité

L'identité humaine, l'organisation, le workspace, la direction, le bureau et l'agent sont des concepts distincts. Un agent IA n'est pas un membre humain Supabase Auth. Le mapping d'un agent à une direction doit être explicite et workspace-scoped.

### 9.2 Lecture des bureaux

Les bureaux sont des projections (read models) assemblées à partir de missions, messages, artifacts, événements, assignments et agents. Il faut éviter de dupliquer dans une table de bureau des états déjà détenus par les objets métier. Les agrégations doivent être paginées, filtrées, autorisées côté serveur et adaptées au mobile.

## 10. Catalogue de capacités initial

| Domaine | Capacités à enregistrer |
|---|---|
| Recherche | recherche documentaire, extraction, provenance, corroboration, synthèse |
| Stratégie | diagnostic, options, analyse concurrentielle, prospective |
| Finance | budget, coûts, trésorerie, VAN/TRI si données suffisantes, sensibilité |
| Commercial | segmentation, demande, concurrence, pricing, prévisions |
| Opérations | capacité, processus, approvisionnement, logistique, planning |
| Risques | identification, évaluation, contrôles, stress-test, faisabilité |
| Audit | revue de preuve, cohérence, conformité du processus, traçabilité |
| Technologie | architecture, code, sécurité, tests, déploiement contrôlé |

Une capacité déclarée ne vaut pas qualification professionnelle ni autorité réglementaire. Chaque capacité possède une description, un niveau, des limites, les outils requis et des tests d'évaluation.

## 11. Plan de réalisation par tranches

### Phase 1 — Référentiel et fondations organisationnelles
- Adopter ce document comme source d'autorité.
- Créer le catalogue typé des directions, mandats et capacités.
- Formaliser les contrats Department, Office, AgentAssignment et MissionAssignment.
- Vérifier l'existant (workspace, agent, department, mission) avant toute migration.
- Définir les ADR de modèle de données et de navigation.
- Critères : catalogue cohérent, types stricts, tests de routage, aucune donnée/production modifiée.

### Phase 2 — Répertoire et bureaux
- API serveur pour lire l'organigramme et les détails des bureaux.
- Vue Siège, organigramme, bureau DG, bureaux de direction, fiche agent.
- Agrégation à partir des données persistantes; droits vérifiés.
- Critères : tests d'accès, états UI complets, responsive mobile.

### Phase 3 — Intake DG et routage intelligent
- Formulaire de mission en langage naturel.
- Plan de mission structuré, justification des directions mobilisées.
- Affectations dynamiques et budget de mission.
- Critères : sélection déterministe vérifiable, clarification si donnée indispensable absente, tests de couverture des compétences.

### Phase 4 — Communication, handoff et livrables
- Messages mission-scoped, idempotence, clarification, handoff, réponse, review.
- Artifacts versionnés et reliés aux missions/agents/preuves.
- Critères : pas de perte/doublon, isolation workspace, audit cohérent.

### Phase 5 — Gouvernance et contrôle
- Revue indépendante, Contradiction Lab transversal, approbations, mémoire validée.
- Critères : séparation des tâches et approbation liée au payload.

### Phase 6 — Exploitation et évaluation
- Performance par bureau/agent, coûts, observabilité, reprise et tests multi-workers.
- Critères : E2E complet, sécurité, budget, preuve Preview.

## 12. Matrice d'acceptation de la Phase 1

| ID | Exigence | Preuve attendue |
|---|---|---|
| ORG-001 | Hiérarchie Président → DG → directions → équipes → agents définie | Catalogue + tests |
| ORG-002 | 8 directions métiers initiales et DG clairement distingué | Catalogue versionné |
| ORG-003 | Mandats et capacités bornés | Validation statique + tests |
| ORG-004 | Bureau distinct du rattachement agent | Contrats de domaine |
| ORG-005 | Équipe de mission dynamique sans modifier l'organigramme | Tests de sélection |
| ORG-006 | Contradiction Lab transversal | Contrat fonctionnel |
| ORG-007 | Mission, message, artifact, event et review séparés | ADR + modèle |
| ORG-008 | Pas de migration aveugle / compatibilité | Audit existant |
| ORG-009 | Production et baseline intouchées | Ref/CI/migrations vérifiés |

## 13. Décisions d'architecture (résumé)

- **ADOPTÉ** : organisation hiérarchique stable + cellules de mission dynamiques.
- **ADOPTÉ** : bureaux numériques par fonction; fiche/espace logique par agent.
- **ADOPTÉ** : DG comme orchestrateur, pas comme exécutant universel.
- **ADOPTÉ** : Contradiction Lab comme capacité transversale.
- **ADOPTÉ** : le workspace reste frontière de sécurité; l'organisation est un modèle fonctionnel à l'intérieur du périmètre autorisé.
- **ADOPTÉ** : les bureaux sont des read models sur données métier persistantes.
- **À implémenter** : messagerie/handoff, artifacts, revues et read models complets; ne pas les déclarer disponibles avant tests.
- **À vérifier** : schéma existant des départements et agents avant migration de rattachement.

## 14. Gouvernance du référentiel

Toute évolution future doit :
1. citer la section du présent référentiel qu'elle met en œuvre;
2. préciser si elle est compatible, additive ou nécessite un ADR;
3. fournir les tests et preuves;
4. rester sur branche de développement et TEST/Preview;
5. préserver les baselines et les contrats historiques.

Ce document est le référentiel directeur à partir duquel le Blueprint global, le programme A-I, l'architecture des données, les API, les workers et l'interface seront progressivement alignés.
