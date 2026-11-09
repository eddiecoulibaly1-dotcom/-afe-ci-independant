# Registre proposé des dépendances — AFE-CI COO (P1)

**Date d'analyse :** 9 novembre 2026  
**Espace :** AFE-CI GOUVERNANCE & CONFORMITÉ  
**Workspace :** `4548e990-54a2-4900-8736-37c060d8b67e`  
**Environnement :** projet Supabase de test uniquement  
**Statut :** proposition métier formalisée — relations non enregistrées dans les tables opérationnelles  
**Référence technique :** `afe_agent_mission_dependencies` existe au niveau mission ; aucune table de dépendance entre tâches n'est présente dans le schéma examiné.

## 1. Règles de qualification

Une relation est une **dépendance dure** seulement si le livrable amont est indispensable à l'exécution ou à l'acceptation du travail aval. La similarité des titres, une collaboration souhaitable ou un ordre chronologique ne suffisent pas.

Types :
- `HARD_PREREQUISITE` : le travail aval ne peut pas commencer/être accepté sans le livrable amont.
- `INPUT_REFERENCE` : le livrable est un contexte utile ; il ne bloque pas l'exécution.
- `PARALLEL` : les tâches peuvent avancer simultanément.
- `OVERLAP_REVIEW` : chevauchement de périmètre à clarifier ; ne pas créer de dépendance artificielle.
- `HUMAN_GATE` : décision réservée à la DG / autorité humaine ou contrôle indépendant.

Une dépendance n'est satisfaite que par un livrable effectivement remis, rattaché à sa tâche source, complet et vérifiable. Un statut de tâche seul ou une promesse de livraison ne suffit pas. Pour les travaux soumis à revue indépendante, la revue doit être positive avant de libérer le consommateur.

## 2. Missions actives analysées

| Mission | Direction responsable | Responsable affecté | État observé | Livrable final attendu |
|---|---|---|---|---|
| `786ab974-d2c9-4ee6-a2ab-e85b18c4dcf5` — Diagnostic qualité des processus et livrables | Audit qualité | Directeur Audit Qualité | paused, 44 % | État des lieux des mandats, responsabilités, procédures, indicateurs et contrôles qualité |
| `6b4ed9f2-b11a-4181-9c77-e87984298173` — Contrôle de la qualité des livrables et processus | Audit qualité | Directeur Audit Qualité | paused, 34 % | Rapport d'audit qualité consolidé, avec constats, preuves, corrections et conclusions |
| `903d2ffd-36f7-4e9d-8531-16bb707dd2c6` — Analyse des opérations et coordination des missions | Opérations de mission | Directeur des Opérations de mission | paused, 36 % | Rapport d'état des opérations, dépendances, blocages et plan d'amélioration |
| `a65e5aaf-6086-40cb-b1f6-6779ffc1fd63` — Analyse des processus et coordination opérationnelle | Opérations de mission | Directeur des Opérations de mission | paused, 20 % | Cartographie des processus, coordination, responsabilités et rapport d'évaluation |

Les états et pourcentages sont un instantané de l'espace de test au moment de la requête, non une nouvelle modification des données.

## 3. Graphe de dépendances intra-mission proposé

### 3.1 Audit qualité — diagnostic des processus

Mission `786ab974-d2c9-4ee6-a2ab-e85b18c4dcf5`

| Tâche source | Tâche consommatrice | Relation | Motif / livrable attendu |
|---|---|---|---|
| `5ec8735b-3496-44cf-be7e-fde0bfde02a8` Collecter procédures et référentiels | `317b7d85-80e2-46d9-a608-ef284ae0dba5` Préparer le rapport d'état des lieux | HARD_PREREQUISITE | Inventaire des procédures, référentiels et pièces collectées |
| `f1c24e5e-70b2-40a9-ad4d-abda3c7d4c2b` Analyser indicateurs et rapports qualité | `317b7d85-80e2-46d9-a608-ef284ae0dba5` | HARD_PREREQUISITE | Évaluation documentée des indicateurs et rapports |
| `245bb56b-be04-420b-9923-fb5413af5884` Identifier risques et insuffisances | `317b7d85-80e2-46d9-a608-ef284ae0dba5` | HARD_PREREQUISITE | Registre des risques et insuffisances qualité |
| `f63c8f2b-f7da-4c11-bd1f-fb87353e9569` Documenter lacunes organisationnelles | `317b7d85-80e2-46d9-a608-ef284ae0dba5` | HARD_PREREQUISITE | Analyse des lacunes, séparation des tâches, habilitations et ressources |

Les quatre tâches sources peuvent être exécutées en parallèle. La rédaction du rapport final de cette mission attend les quatre livrables.

### 3.2 Audit qualité — contrôle des livrables et processus

Mission `6b4ed9f2-b11a-4181-9c77-e87984298173`

| Tâche source | Tâche consommatrice | Relation | Motif / livrable attendu |
|---|---|---|---|
| `26c48c9c-8a03-455e-9400-3db04b373511` Mettre en place le cadre qualité | `321add22-1a8b-4363-a1b1-5781c1f3cf4d` Auditer la conformité des livrables | HARD_PREREQUISITE | Référentiel de critères, méthodes et seuils de contrôle |
| `321add22-1a8b-4363-a1b1-5781c1f3cf4d` Auditer la conformité | `9d89c208-590a-48cb-9152-9a043c6785cf` Suivre les corrections | HARD_PREREQUISITE | Constats numérotés, non-conformités, gravité, responsable de correction et échéance |
| `330e26e1-f509-4033-bfe3-1d8111ea8b09` Vérifier traçabilité et complétude des preuves | `a542ddba-ed92-45a4-bfd0-ddf1f2683a2c` Rapport d'audit consolidé | HARD_PREREQUISITE | Matrice de preuves, source, propriétaire, date, intégrité et statut de vérification |
| `9d89c208-590a-48cb-9152-9a043c6785cf` Suivre les corrections | `a542ddba-ed92-45a4-bfd0-ddf1f2683a2c` | HARD_PREREQUISITE | Registre des corrections, preuves de mise en œuvre et statut de vérification |
| `321add22-1a8b-4363-a1b1-5781c1f3cf4d` Auditer la conformité | `a542ddba-ed92-45a4-bfd0-ddf1f2683a2c` | HARD_PREREQUISITE | Résultats de contrôle et constats validés |
| `26c48c9c-8a03-455e-9400-3db04b373511` Cadre qualité | `a542ddba-ed92-45a4-bfd0-ddf1f2683a2c` | INPUT_REFERENCE | Référentiel d'évaluation cité dans le rapport final |

**Blocage explicite :** la tâche de suivi des corrections indique qu'aucun registre formalisé n'existe et que les retours ne sont pas finalisés. Le registre des corrections doit donc devenir un livrable obligatoire de la tâche d'audit de conformité, puis être alimenté par les responsables des corrections. La tâche de rapport consolidé ne peut être acceptée tant que les corrections critiques ne sont pas traitées ou formellement signalées comme non résolues avec justification.

### 3.3 Opérations de mission — analyse et coordination

Mission `903d2ffd-36f7-4e9d-8531-16bb707dd2c6`

| Tâche source | Tâche consommatrice | Relation | Motif / livrable attendu |
|---|---|---|---|
| `4367ee7e-a21d-4578-b7a4-4cb59b832934` Recueillir les données des missions et tâches | `cc632b9f-57e6-4a6e-b58d-24afef493951` Proposer les axes d'amélioration | HARD_PREREQUISITE | Inventaire horodaté des missions, tâches, responsables, échéances, statuts et blocages |
| `9f3b9c80-0a15-440f-8ed3-b585a2ed9969` Analyser coordination et suivi | `cc632b9f-57e6-4a6e-b58d-24afef493951` | HARD_PREREQUISITE | Diagnostic des mécanismes de coordination et de suivi |
| `c8df9b33-361a-4976-84c7-8b3161713777` Identifier chevauchements et dépendances | `cc632b9f-57e6-4a6e-b58d-24afef493951` | HARD_PREREQUISITE | Registre des chevauchements, blocages, causes et dépendances |
| `cc632b9f-57e6-4a6e-b58d-24afef493951` Axes d'amélioration | `ebf288dd-7687-4970-a221-23780289830d` Rapport d'état des opérations | HARD_PREREQUISITE | Recommandations priorisées, responsables proposés, échéances et indicateurs |

Les trois tâches d'analyse peuvent avancer en parallèle. Les recommandations et le rapport attendent leurs résultats.

### 3.4 Opérations de mission — processus et coordination opérationnelle

Mission `a65e5aaf-6086-40cb-b1f6-6779ffc1fd63`

| Tâche source | Tâche consommatrice | Relation | Motif / livrable attendu |
|---|---|---|---|
| `2c5f67ca-77ac-4bf1-97cd-32930abcfdbf` Cartographier les processus | `b89761a2-cf19-4c7c-b665-d9e5a1dbfd1e` Rapport d'évaluation | HARD_PREREQUISITE | Cartographie des processus, entrées, sorties, contrôles et acteurs |
| `0b750f7e-0084-4e81-9b30-d95aefe53605` Étudier la coordination entre directions | `b89761a2-cf19-4c7c-b665-d9e5a1dbfd1e` | HARD_PREREQUISITE | Matrice des interfaces, transferts et points de friction |
| `b14a85fc-227c-437f-8662-6c46e644288c` Analyser la répartition des responsabilités | `b89761a2-cf19-4c7c-b665-d9e5a1dbfd1e` | HARD_PREREQUISITE | Matrice de responsabilités et lacunes de redevabilité |
| `43ad4e76-66ff-4571-a9e4-2156b82c5801` Suivre l'avancement des missions | `b89761a2-cf19-4c7c-b665-d9e5a1dbfd1e` | HARD_PREREQUISITE | Tableau d'avancement, retards et mécanismes de relance |

Les quatre analyses peuvent être conduites en parallèle, sous réserve que le suivi des missions dispose d'un instantané de données fiable. Le rapport final attend les quatre résultats.

## 4. Dépendances inter-directions proposées

### 4.1 Documentation & Reporting vers Audit qualité

Missions amont terminées :
- `9cc6482a-77ca-4377-9895-0ca8fb3026e3` — Examen de la documentation et qualité du reporting.
- `4733960a-e455-4103-98e4-74933e23ef20` — État des lieux des processus documentaires et rapports.

Livrables disponibles dans leurs résultats :
- revue des systèmes documentaires ;
- état de traçabilité et de complétude des dossiers de preuves ;
- analyse qualitative des rapports et indicateurs ;
- dossier de collecte des preuves associé ;
- rapport d'analyse documentaire et recommandations ;
- inventaire des procédures, outils, ressources et risques documentaires.

Relations :
1. Les livrables de `9cc6482a-77ca-4377-9895-0ca8fb3026e3` sont des prérequis de preuve pour la tâche `330e26e1-f509-4033-bfe3-1d8111ea8b09` de la mission Audit qualité `6b4ed9f2-b11a-4181-9c77-e87984298173`.
2. Les livrables de `4733960a-e455-4103-98e4-74933e23ef20` sont des références d'entrée pour les tâches de collecte et d'audit de la mission `786ab974-d2c9-4ee6-a2ab-e85b18c4dcf5`.
3. Ces missions étant déjà terminées, les références doivent être vérifiées et liées ; elles ne doivent pas créer d'attente artificielle.

### 4.2 Risques & Contrôle vers les travaux de coordination

Missions amont terminées :
- `726d9d13-97be-480c-9444-b46405ff0e2a` — Cartographie des risques et dispositif de contrôle.
- `03f5f93f-4ca6-499c-bc8f-8583c7d481f4` — Cartographie des risques et contrôle des dispositifs.

Livrables disponibles :
- cartographie actualisée des risques ;
- évaluation des dispositifs de maîtrise et contrôles ;
- liste des insuffisances et risques non couverts ;
- blocages nécessitant escalade à la DG ;
- recommandations et rapports consolidés.

Relations :
- `INPUT_REFERENCE` pour `c8df9b33-361a-4976-84c7-8b3161713777` (identification des blocages et dépendances) et `cc632b9f-57e6-4a6e-b58d-24afef493951` (axes d'amélioration).
- Ne pas rendre ces analyses de risques bloquantes : les missions sont terminées et les opérations peuvent poursuivre leur collecte.

### 4.3 Gouvernance & Conformité vers les travaux de coordination

Missions amont terminées :
- `92deda8b-aa4c-41cf-ba81-aae128c87cb5` — Diagnostic gouvernance, conformité et contrôles déontologiques.
- `2b3efc78-8a3c-448f-a86e-907b7f0b34a7` — Analyse de la gouvernance et conformité.

Livrables disponibles :
- analyse des politiques et procédures ;
- traçabilité des décisions et approbations ;
- risques de non-conformité et conflits d'intérêts ;
- recommandations et plan d'escalade DG ;
- rapport consolidé de gouvernance et conformité.

Relations :
- `INPUT_REFERENCE` pour l'analyse de la répartition des responsabilités `b14a85fc-227c-437f-8662-6c46e644288c` et l'analyse des blocages nécessitant une décision DG.
- Ces livrables sont des références disponibles, non des prérequis bloquants.

## 5. Chevauchements à traiter sans créer de cycle

Deux missions sont confiées à Opérations de mission :
- `903d2ffd-36f7-4e9d-8531-16bb707dd2c6` — analyse de l'état des opérations, des missions, des blocages et des plans de rattrapage ;
- `a65e5aaf-6086-40cb-b1f6-6779ffc1fd63` — cartographie des processus, coordination entre directions et répartition des responsabilités.

Leurs périmètres se recoupent sur la coordination et le suivi. La proposition est :
1. maintenir les collectes et analyses descriptives en parallèle ;
2. faire de la cartographie, de l'analyse des interfaces et de la matrice de responsabilités de `a65e5aaf-6086-40cb-b1f6-6779ffc1fd63` des `INPUT_REFERENCE` pour les recommandations de `903d2ffd-36f7-4e9d-8531-16bb707dd2c6` ;
3. ne pas créer de dépendance réciproque entre les deux missions ;
4. demander au COO de confirmer qu'il s'agit bien de deux livrables distincts et non d'une duplication à fusionner.

De même, les deux missions Audit qualité ont des objectifs proches mais différents : l'une réalise l'état des lieux de la direction elle-même, l'autre contrôle la qualité des livrables du diagnostic global. Ne pas autoriser l'auto-validation : l'état des lieux de la direction Audit qualité ne peut pas remplacer une revue indépendante.

## 6. Ordre de travail recommandé

1. **En parallèle immédiatement :** les quatre tâches de collecte/analyse de la mission `786ab974...`, les tâches de cadrage et d'audit de `6b4ed9f2...`, les trois tâches d'analyse de `903d2ffd...`, et les quatre tâches d'analyse de `a65e5aaf...` qui ne sont pas explicitement bloquées par un livrable manquant.
2. **Après analyses :** rapport d'état des lieux Audit qualité (`317b7d85...`), axes d'amélioration Opérations de mission (`cc632b9f...`) et rapports de synthèse associés.
3. **Après le contrôle de conformité :** ouvrir le registre de corrections, assigner chaque action à la direction qui détient le processus ou le livrable concerné, fixer une échéance et exiger une preuve de correction.
4. **En dernier :** rapport consolidé d'audit qualité (`a542ddba...`) après revue des preuves et vérification des corrections.

Les tâches déjà en cours ne doivent pas être remises à zéro. Les dépendances proposées doivent être appliquées sans effacer leur historique ni leur progression.

## 7. Règles d'imputation des retards et d'escalade

- **Responsable du retard :** la direction propriétaire du livrable amont non remis à l'échéance, et non automatiquement la direction consommatrice bloquée.
- **Retard partagé :** si le livrable amont a été remis mais rejeté pour non-conformité, l'imputation reste à la direction productrice jusqu'à acceptation ; si le consommateur n'exploite pas un livrable accepté, l'imputation passe au consommateur.
- **Reprise :** uniquement lorsque tous les prérequis durs sont acceptés, que les blocages propres à la tâche sont levés et que les éventuelles approbations sont obtenues.
- **COO :** relance le directeur responsable, consolide l'impact planning et propose une mesure de contournement sans supprimer le prérequis.
- **DG :** arbitrage si conflit de priorité ou de ressources, dépendance inter-directions dépassant son délai cible, désaccord sur la responsabilité, risque critique, blocage qui menace une échéance institutionnelle, ou décision réservée à l'humain.
- **Indépendance :** l'arbitrage indépendant, l'audit interne indépendant et l'autorité de validation humaine ne sont jamais des ressources subordonnées au COO.

## 8. Contrat minimal d'un livrable

Avant d'être utilisé comme prérequis, chaque livrable doit comporter :
- identifiant stable et version ;
- mission et tâche productrices ;
- direction et responsable producteur ;
- type de livrable et format attendu ;
- périmètre et période couverts ;
- critères d'acceptation mesurables ;
- pièces/preuves sources et provenance ;
- statut : draft, submitted, accepted, rejected, superseded ;
- réviseur/approbateur requis et date de décision.

Une tâche consommatrice référence l'identifiant/version du livrable accepté, pas seulement la mission amont.

## 9. Écart technique avant enregistrement

Le schéma présent possède une relation mission → mission (`afe_agent_mission_dependencies`) avec protection contre l'auto-dépendance, les cycles et le franchissement de workspace. Il ne possède pas de relation tâche → tâche, ni de contrat de livrable versionné dans `afe_operational_tasks`.

Par conséquent :
- ne pas traduire mécaniquement toutes les relations du présent graphe en dépendances mission → mission : cela bloquerait des missions entières alors que seules certaines tâches attendent ;
- ne pas enregistrer les relations `INPUT_REFERENCE` comme des blocages ;
- ne pas considérer un `completed` de mission comme preuve de qualité sans vérifier ses livrables ;
- construire une couche additive de dépendances tâche → tâche et de références de livrables acceptés, avec isolation workspace, garde anti-cycle, audit append-only et contrôles de concurrence ;
- garder le mécanisme actuel de dépendance mission comme garde-fou de niveau mission.

## 10. Décision de mise en œuvre

Ce document constitue le registre d'analyse proposé. Aucune relation opérationnelle nouvelle n'a été insérée dans `afe_agent_mission_dependencies`, aucune tâche n'a été modifiée et aucune migration n'a été appliquée pendant cette formalisation.

La prochaine étape technique doit implémenter le modèle tâche/livrable, les règles de déblocage et l'écran de revue COO. L'enregistrement des relations ne doit intervenir qu'après validation du graphe, des livrables et des critères d'acceptation par le COO ; les décisions réservées restent soumises à la DG.
