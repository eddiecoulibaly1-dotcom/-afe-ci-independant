# AFE-CI Autonomous Organization V1
## Blueprint institutionnel et organisation opérationnelle

**Version :** 1.1.0  
**Date :** 7 novembre 2026  
**Environnement de référence :** workspace de test AFE-CI GOUVERNANCE & CONFORMITÉ  
**Statut :** Organisation de référence structurée en test ; moteur COO IA niveau 2 implémenté et compilé en Preview ; recette authentifiée d'orchestration encore requise.  
**Autorité :** Direction générale humaine.

## 1. Objet et modèle d'entreprise

AFE-CI Autonomous Organization est une entreprise numérique d'intelligence opérationnelle, d'analyse, de contrôle, de recherche, de délibération contradictoire et d'aide à la décision. Elle transforme une orientation ou un mandat humain en missions structurées, travaux attribués à des agents spécialisés, preuves traçables, contrôles indépendants, livrables et recommandations soumises aux autorités compétentes.

L'entreprise fonctionne selon trois lignes de responsabilité :
1. **Gouvernance exécutive humaine** : la Direction générale fixe le cap et conserve les décisions réservées.
2. **Exécution orchestrée par IA** : le COO IA coordonne les directions et les opérations dans les limites de son mandat.
3. **Assurance et décision indépendantes** : l'Audit interne, l'Arbitrage indépendant et l'Autorité de validation humaine ne sont pas placés sous le pouvoir de décision du COO.

L'organisation n'est pas un ensemble d'agents conversationnels autonomes sans contrôle. Chaque agent possède un mandat, une direction de rattachement, un niveau d'autonomie, des limites et une responsabilité de compte rendu.

## 2. Organigramme fonctionnel

```text
DIRECTION GÉNÉRALE — HUMAINE
│
├── Direction des Opérations — COO IA
│   ├── Finance & Investissements
│   ├── Evidence Intelligence
│   ├── Secrétariat général des missions
│   ├── Opérations de mission
│   ├── Audit qualité
│   ├── Documentation & Reporting
│   └── Infrastructure & Sécurité
│
├── Stratégie & Développement — accès direct DG
├── Risques & Contrôle — accès direct DG
├── Gouvernance & Conformité — accès direct DG
│
├── Audit interne indépendant — accès direct DG
├── Arbitrage indépendant — hors hiérarchie opérationnelle
└── Autorité de validation humaine — humaine exclusivement
```

Le COO peut coordonner les travaux et les ressources des directions opérationnelles. Le rattachement fonctionnel direct à la DG de Stratégie, Risques & Contrôle et Gouvernance & Conformité protège la qualité du conseil, l'escalade et la surveillance. L'Audit interne et l'Arbitrage sont indépendants du COO. La Validation humaine ne possède aucun directeur IA.

## 3. Directions, mandats et responsables

| Direction | Mandat principal | Responsable initial |
|---|---|---|
| Direction générale | Stratégie, délégations, priorités et décisions réservées | Propriétaire humain du workspace |
| Direction des Opérations | Portefeuille, coordination, capacités, délais, alertes et reporting | **AFE-CI COO IA** |
| Stratégie & Développement | Analyse stratégique, scénarios, objectifs et feuille de route | AFE-CI STRATÉGIE |
| Finance & Investissements | Budgets, prévisions, rentabilité et analyse des investissements | AFE-CI FINANCE & INVESTISSEMENTS |
| Risques & Contrôle | Cartographie des risques, contrôles, KRI et plans de traitement | Directeur des Risques & Contrôle |
| Gouvernance & Conformité | Délégations, conformité, conflits d'intérêts et séparation des tâches | Directeur Gouvernance & Conformité |
| Evidence Intelligence | Collecte contrôlée, provenance, intégrité et qualification des preuves | Directeur Evidence Intelligence |
| Secrétariat général | Mandats, dossiers, affectations et complétude administrative | Directeur du Secrétariat général |
| Opérations de mission | Décomposition des plans, tâches, dépendances et exécution | Directeur des Opérations de mission |
| Audit qualité | Assurance qualité des procédures et livrables | Directeur Audit Qualité |
| Documentation & Reporting | Rapports, tableaux de bord, versions et archivage | Directeur Documentation & Reporting |
| Infrastructure & Sécurité | Architecture, disponibilité, habilitations et sécurité | Directeur Technologie & Innovation |
| Audit interne indépendant | Assurance indépendante sur gouvernance, risques et contrôles | Directeur de l’Audit Interne |
| Arbitrage indépendant | Décision motivée après contradiction complète | Arbitre indépendant AFE-CI |
| Autorité de validation humaine | Approbation, rejet, réserves ou reprise | Autorité humaine désignée par la DG |

Les responsables IA sont des identités d'agents distinctes. Leurs mandats ne valent pas délégation illimitée de pouvoirs. Les niveaux d'autonomie initiaux sont limités au niveau 1.

## 4. Mandat du COO IA

Le COO est le responsable de l'exécution opérationnelle, pas le propriétaire de la stratégie ni l'autorité de validation.

Il doit :
- recevoir les objectifs, décisions et priorités de la DG ;
- vérifier la capacité, la disponibilité et les dépendances ;
- proposer un plan d'exécution, des jalons et des critères d'acceptation ;
- soumettre les arbitrages de ressources à la DG lorsqu'ils dépassent sa délégation ;
- créer et coordonner les missions et tâches autorisées ;
- affecter les travaux aux directions et agents compétents ;
- suivre les échéances, livrables, coûts estimés et risques d'exécution ;
- détecter les retards, blocages, échecs, dépassements et conflits de capacité ;
- demander des plans correctifs et suivre leur exécution ;
- produire les rapports quotidiens, hebdomadaires et ad hoc à la DG ;
- maintenir un journal vérifiable des décisions et actions.

Le COO ne peut pas :
- changer la stratégie ou le mandat de la DG ;
- modifier ou supprimer les constats techniques ;
- donner des instructions sur le fond d'un arbitrage indépendant ;
- diriger l'Audit interne indépendant ;
- approuver un rapport ou une dépense à la place d'une personne habilitée ;
- modifier les habilitations, secrets ou règles de sécurité de sa propre initiative ;
- effectuer un paiement, signer un contrat, publier, déployer en Production ou lancer une migration de Production sans approbation humaine explicite.

## 5. Autorités réservées et séparation des pouvoirs

| Décision / action | Autorité compétente | Rôle du COO |
|---|---|---|
| Définition de la stratégie | DG humaine | Prépare les options et exécute après décision |
| Création d'un mandat stratégique | DG humaine | Formalise et planifie |
| Coordination quotidienne | COO IA | Décide dans les délégations opérationnelles |
| Réaffectation de tâches dans un mandat approuvé | COO IA | Autorisé et journalisé |
| Modification du périmètre ou des objectifs | DG humaine | Demande une décision |
| Arbitrage d'un constat | Arbitre indépendant | Aucune influence sur le fond |
| Audit indépendant | Audit interne | Fournit les informations demandées, sans diriger |
| Validation finale | Autorité humaine | Prépare le dossier et suit la décision |
| Dépense, paiement, engagement contractuel | Humain habilité | Prépare l'analyse et demande approbation |
| Publication, déploiement, migration Production | Humain habilité | Prépare et vérifie, sans auto-autorisation |
| Modification des rôles ou privilèges | Administrateur humain habilité | Propose, ne s'auto-attribue rien |

## 6. Cycle opérationnel de l'entreprise

1. **Orientation** — la DG exprime un objectif, un mandat ou une priorité.
2. **Qualification** — le Secrétariat vérifie le périmètre, les livrables, les délais, les accès et les critères.
3. **Planification** — le COO consulte les directions, évalue les capacités et propose un plan.
4. **Autorisation** — les décisions réservées sont validées par la DG avant exécution.
5. **Affectation** — le COO attribue les missions et tâches aux responsables autorisés.
6. **Exécution** — les agents réalisent les travaux et déposent des livrables traçables.
7. **Contrôle** — Risques & Contrôle, Gouvernance, Audit Qualité et Audit interne interviennent selon leurs mandats.
8. **Contradiction** — les analyses sont confrontées selon le protocole applicable.
9. **Arbitrage** — l'arbitre indépendant statue sans instruction opérationnelle.
10. **Validation humaine** — l'autorité compétente approuve, rejette ou demande une reprise.
11. **Clôture et apprentissage** — le dossier est archivé, les actions sont suivies et les indicateurs sont mis à jour.

Un état technique « terminé » ne constitue jamais une validation humaine.

## 7. Pilotage et indicateurs de performance

Le tableau de bord DG/COO doit couvrir au minimum :

- **Portefeuille** : missions par statut, priorité, direction, échéance et niveau de risque.
- **Exécution** : tâches ouvertes, terminées, en retard, bloquées et reprises.
- **Capacité** : charge par direction et agent, disponibilité, files d'attente et dépendances.
- **Qualité** : livrables acceptés au premier passage, reprises, défauts et critères manquants.
- **Risque** : incidents, risques critiques, contrôles échus et plans correctifs.
- **Preuves** : sources collectées, taux de résolution, éléments partiels et non vérifiés.
- **Décisions** : arbitrages en attente, validations humaines requises et ancienneté.
- **Fiabilité** : erreurs d'exécution, reprises, doublons, incidents d'accès et disponibilité.
- **Coûts** : consommation estimée par mission et agent, budgets et alertes de dépassement.

Aucun indicateur ne doit encourager une clôture prématurée, une baisse de qualité ou une dissimulation des blocages.

## 8. Cadence de gestion

- **En continu** : surveillance des tâches, événements, blocages et incidents.
- **Chaque jour** : rapport COO à la DG, portefeuille, alertes critiques, décisions requises et plan du jour.
- **Chaque semaine** : revue des directions, capacité, qualité, risques et prévisions.
- **Chaque mois** : revue de performance, adéquation des mandats, coûts, risques structurels et propositions d'amélioration.
- **À chaque incident critique** : notification immédiate, suspension de l'action risquée et escalade humaine.

Fuseau de référence pour les rapports : UTC, équivalent à l'heure d'Abidjan (UTC+0).

## 9. Gouvernance des agents et sécurité

Chaque agent doit disposer de :
- identité unique et espace de travail associé ;
- mandat explicite et instructions système versionnées ;
- direction et responsable de rattachement ;
- niveau d'autonomie et liste d'outils autorisés ;
- budget, limites de fréquence et limites de durée ;
- règles d'escalade et d'approbation ;
- journal d'exécution et résultat vérifiable.

Le COO ne reçoit pas de clé service-role ni de privilèges SQL arbitraires. Il agit au travers d'outils serveur à périmètre restreint, vérifiés côté serveur et isolés par workspace. Les actions sensibles exigent une approbation humaine. Les outils doivent être idempotents, audités, limités et désactivables par un mécanisme d'arrêt d'urgence.

## 10. Niveaux d'autonomie

- **Niveau 0 — Observation** : lecture et reporting uniquement.
- **Niveau 1 — Assistance** : propositions, plans et recommandations soumis à validation.
- **Niveau 2 — Exécution encadrée** : actions opérationnelles réversibles dans un mandat et une liste d'outils autorisés.
- **Niveau 3 — Orchestration déléguée** : coordination de plusieurs directions dans des limites approuvées, avec supervision et escalade.
- **Niveau 4 — Autonomie étendue** : uniquement après audits, preuves de fiabilité, budgets et délégations explicites.

Le niveau initial des agents créés dans ce lot reste 1, à l'exception du COO IA dédié, explicitement élevé au niveau 2 dans l'environnement de test. Le niveau 3 reste verrouillé.

## 11. État de construction et critères de sortie

### Réalisé dans l'environnement de test
- 15 directions et fonctions institutionnelles enregistrées.
- COO IA dédié créé et désigné comme directeur-agent de la Direction des Opérations dans le registre organisationnel.
- Responsables IA affectés aux directions opérationnelles et de contrôle disponibles.
- Agents distincts pour Audit interne indépendant et Arbitrage indépendant.
- Direction générale et Autorité de validation humaine protégées comme fonctions humaines.
- Paramètres de reporting DG initialisés à 08:00 UTC.
- Référentiel des directions et mapping des agents alignés dans le code de la branche.

### Réalisé dans le moteur COO IA
- Désignation du COO IA par `coo_agent_id`, activation, niveau d'autonomie et arrêt d'urgence.
- Orchestrateur IA qui transforme une instruction DG en plan JSON contraint et chantiers distribués.
- Validation serveur des directions, responsables, objectifs, échéances et plafonds de délégation.
- Création des missions et tâches dans la file durable existante.
- Mise en attente sans distribution lorsqu'une décision réservée à l'humain est identifiée.
- Registre `afe_coo_runs`, idempotence, événements et audit.
- Plafond de 10 orchestrations par workspace sur 24 heures ; maximum 8 chantiers et 8 tâches par chantier.
- Kill switch bloquant les nouvelles orchestrations.

### À réaliser avant de déclarer l'entreprise pleinement opérationnelle
- Exécuter une orchestration réelle depuis une session DG authentifiée dans le Preview.
- Vérifier les missions et tâches créées, les reprises, les alertes et le reporting DG.
- Vérifier les cas de plan en attente d'approbation, de kill switch et de directeur indisponible.
- Valider l'isolation, les permissions et l'ensemble des tests.
- Évaluer les résultats et la fiabilité avant toute demande d'élévation au niveau 3.

## 12. Protection des environnements

Les travaux de ce lot sont limités à la branche `feature/autonomous-organization-v1` et au projet Supabase de test `afe-ci-test`. Aucun merge vers `main`, aucune modification de la baseline V1.0.7, aucune migration ni aucun déploiement Production ne sont autorisés par ce document.

La présente organisation est un référentiel institutionnel et une configuration de test. Elle ne constitue pas une incorporation juridique ni une délégation de pouvoirs réels.
