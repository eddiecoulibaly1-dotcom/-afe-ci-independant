# AFE-CI — Manuel de procédures d’utilisation
## Direction des Opérations (COO) · Version 1.0

**Document de référence utilisateur**  
**Périmètre :** espace de travail AFE-CI, écran `/coo`, fonctions de pilotage opérationnel et lien vers « Équipe & Gouvernance ».  
**Public :** Direction générale, COO, administrateurs, responsables opérationnels et lecteurs autorisés.

---

## 1. Objet, périmètre et règles de lecture

Ce manuel décrit les fonctions réellement présentes dans le poste de commandement COO : connexion, sélection de l’espace, vue centrale, portefeuille des missions, directions, tâches et affectations, alertes, reporting à la Direction générale, paramètres COO et dossier détaillé de contrôle d’une mission.

Le manuel distingue :
- **Consulter** : lire les informations sans les modifier.
- **Préparer** : saisir une instruction, une mission ou une tâche avant de l’enregistrer.
- **Enregistrer** : transmettre une modification au serveur. Un message de confirmation doit apparaître.
- **Exécuter** : lancer le worker sur des missions éligibles. Cette action déclenche un traitement réel.
- **Contrôler** : examiner les livrables et la revue indépendante.
- **Valider / clôturer** : décision réservée à l’autorité humaine habilitée. Une revue indépendante acceptée ne vaut pas, à elle seule, validation humaine.

Les intitulés et droits visibles peuvent dépendre du rôle attribué au compte et de la configuration du workspace. Les champs non affichés à un rôle ne doivent pas être considérés comme disponibles.

### Règles impératives de gouvernance

1. L’espace de travail sélectionné détermine le périmètre des données affichées et des opérations. Vérifier son nom avant toute modification.
2. La Direction générale conserve les décisions stratégiques, les engagements sensibles et la validation humaine finale.
3. Le COO IA peut planifier et déléguer des opérations dans les limites de son mandat. Il ne remplace ni l’arbitrage indépendant ni l’autorité humaine.
4. L’Arbitrage indépendant, l’Audit interne indépendant et l’Autorité de validation humaine sont des fonctions protégées. Elles ne doivent pas être affectées comme directions opérationnelles ordinaires.
5. Une mission n’est pas réputée achevée simplement parce qu’un agent a produit un texte ou déclaré son travail terminé. Les tâches, preuves, livrables, contrôles et validations doivent être examinés.
6. Ne jamais modifier les paramètres d’autonomie ou activer/désactiver le moteur sans mandat explicite de la Direction générale.
7. Ne jamais communiquer un mot de passe, une clé API, un jeton de session ou un secret dans une instruction, une mission, une tâche ou un rapport.

---

## 2. Accéder à l’application et ouvrir une session

### 2.1 Ouvrir le poste COO

1. Ouvrir le lien officiel de l’espace COO communiqué par l’administrateur de l’entreprise.
2. Vérifier que l’adresse comporte le chemin `/coo` et que l’en-tête affiche **AFE-CI · Direction des Opérations**.
3. Ne pas utiliser un lien Debate Engine ou une autre Preview qui ne correspond pas à l’espace COO officiel.
4. Attendre le chargement de la page.

### 2.2 Se connecter

Lorsque la carte **Connexion à AFE-CI** apparaît :

1. Saisir l’adresse e-mail associée au compte.
2. Saisir le mot de passe habituel.
3. Cliquer sur **Se connecter** ou appuyer sur Entrée depuis le champ mot de passe.
4. Attendre le message de connexion et le chargement des espaces de travail.

Le mot de passe est transmis au service d’authentification et n’est pas conservé par la page COO. La session est ensuite utilisée pour les appels authentifiés.

**En cas d’échec :**
- vérifier l’adresse e-mail et le mot de passe ;
- vérifier que le compte a bien été invité dans le workspace ;
- actualiser la page et réessayer ;
- si la session a expiré, se reconnecter ;
- si le compte est authentifié mais qu’aucun workspace n’apparaît, demander à un propriétaire de vérifier l’adhésion au workspace.

Ne pas créer un nouveau compte pour contourner un problème d’accès sans instruction de l’administrateur : cela pourrait créer un compte distinct sans les droits ni l’historique attendus.

### 2.3 Sélectionner un espace de travail

Le champ **Espace de travail** liste les espaces auxquels le compte a accès. Sélectionner le workspace concerné. Le rôle associé est affiché à côté.

Avant chaque opération importante, contrôler :
- le nom du workspace ;
- le rôle affiché ;
- le titre de la mission ou de la tâche concernée.

Changer de workspace recharge les données du nouvel espace. Les données ne sont pas fusionnées entre espaces.

### 2.4 Actualiser

Le bouton **Actualiser** recharge la vue active depuis le serveur. L’utiliser après une opération, après une attente d’exécution ou lorsqu’un autre membre a pu modifier les données. Si le résultat ne se met pas à jour, vérifier le message d’état avant de recommencer une action afin d’éviter les doublons.

---

## 3. Comprendre les rôles et les droits

Les rôles connus du workspace sont :

- **Owner / Propriétaire** : contrôle principal du workspace. Peut administrer les paramètres réservés au propriétaire et exercer les décisions de validation finale prévues par l’application.
- **Admin / Administrateur** : dispose de droits élevés de gestion, dans les limites fixées par les contrôles serveur. Certaines opérations restent réservées au propriétaire.
- **Editor / Éditeur** : peut contribuer aux opérations et aux contenus autorisés, sans disposer de tous les pouvoirs d’administration.
- **Viewer / Lecteur** : consulte les informations autorisées sans pouvoir réaliser les modifications réservées aux rôles supérieurs.

Les droits sont vérifiés par le serveur. L’apparition ou l’absence d’un bouton dans l’interface ne remplace pas cette vérification. Si une action renvoie « Accès refusé », ne pas essayer de contourner le contrôle : demander le droit approprié au propriétaire.

Le COO désigné peut disposer de droits opérationnels spécifiques. Les opérations sensibles et les décisions réservées restent soumises aux contrôles humains.

---

## 4. Navigation générale

Le bandeau supérieur présente :
- **AFE-CI · Direction des Opérations** : identification de l’espace ;
- **Équipe & Gouvernance** : ouvre l’espace de gestion de l’équipe et de la gouvernance ;
- **Actualiser** : recharge la vue active.

La barre de contexte présente :
- **Espace de travail** : sélection du workspace ;
- **Rôle** : rôle effectif du compte dans le workspace.

Les onglets du poste COO sont :

1. **Vue centrale**
2. **Portefeuille des missions**
3. **Directions**
4. **Tâches & affectations**
5. **Alertes**
6. **Reporting DG**
7. **Paramètres COO**
8. **Manuel d’utilisation** (présent dans la version intégrant ce manuel)

Chaque onglet charge des données depuis le workspace courant. En cas d’erreur, lire le message affiché avant de changer d’onglet ou de relancer une opération.

---

## 5. Vue centrale — tableau de bord opérationnel

### 5.1 Finalité

La Vue centrale donne une lecture synthétique de la situation opérationnelle. Elle sert à repérer les retards, blocages, alertes et besoins de décision, puis à orienter l’utilisateur vers le portefeuille, les tâches ou le centre d’alertes.

### 5.2 Indicateurs de situation opérationnelle

Les cartes affichent notamment :

- **Missions actives** : missions en cours de traitement selon leur statut opérationnel.
- **Missions terminées** : missions portant le statut terminé. Ce nombre ne dispense pas de vérifier le dossier de contrôle et les tâches.
- **Missions en retard** : missions dont l’échéance est dépassée et qui ne sont pas dans un statut final.
- **Missions bloquées** : missions suspendues ou portant un motif de blocage.
- **Tâches ouvertes** : tâches qui ne sont pas encore terminées ou annulées.
- **Tâches bloquées** : tâches dont le statut est bloqué.
- **Tâches en retard** : tâches dont l’échéance est dépassée et qui ne sont pas terminées ou annulées.
- **Alertes ouvertes** : alertes qui restent à traiter.
- **Alertes critiques** : alertes ouvertes de sévérité critique.
- **Validations humaines en attente** : décisions pour lesquelles une intervention humaine est encore attendue.

Les nombres sont des indicateurs de suivi, pas des décisions automatiques. Un indicateur nul ne prouve pas l’absence de risque si des informations n’ont pas encore été enregistrées.

### 5.3 Performance par direction

Chaque ligne présente le nom de la direction, son nombre de missions, ses tâches ouvertes, ses tâches bloquées et, lorsque le calcul est possible, le taux de tâches terminées.

Si l’application affiche **Pas encore de données**, ne pas interpréter cette mention comme un taux de 0 %. Elle signifie que le taux n’est pas calculable à partir des éléments disponibles.

### 5.4 Alertes prioritaires et missions à risque

Lire le titre, la description, la date et le niveau de sévérité de chaque alerte. Pour les missions à risque, examiner la direction, le statut, l’échéance et la priorité. Ouvrir ensuite l’onglet correspondant pour effectuer le suivi détaillé.

### 5.5 Procédure quotidienne recommandée

1. Ouvrir la Vue centrale.
2. Vérifier le workspace et l’heure d’actualisation.
3. Examiner les missions en retard et bloquées.
4. Examiner les tâches en retard et bloquées.
5. Examiner les alertes critiques.
6. Examiner les validations humaines en attente.
7. Ouvrir le portefeuille ou les tâches pour traiter les causes.
8. Consigner toute décision ou demande de correction dans le dossier correspondant.
9. Générer ou consulter le rapport destiné à la Direction générale selon la périodicité convenue.

---

## 6. Portefeuille des missions

### 6.1 Finalité et contenu

Le Portefeuille rassemble les missions du workspace. Il permet de transmettre une instruction au COO IA, d’enregistrer une mission manuellement, de suivre les missions, de consulter leur dossier de contrôle, de mettre à jour un pourcentage de progression et de lancer le worker lorsque les conditions sont réunies.

Les indicateurs du portefeuille distinguent :
- les missions soumises à validation COO ;
- les missions pour lesquelles des corrections sont demandées ;
- les revues indépendantes acceptées ;
- le nombre d’anomalies relevées par les revues.

### 6.2 Transmettre une instruction directe au COO IA

Cette zone sert à formuler un objectif de travail au COO, qui prépare les chantiers, consulte les directions IA disponibles et peut créer des missions et tâches dans la file durable.

Procédure :
1. Rédiger une instruction claire dans **Instruction directe au COO IA**.
2. Décrire le résultat recherché, le contexte, le périmètre, les directions concernées et les livrables attendus.
3. Préciser les contraintes, les exclusions, l’échéance et les critères de réussite.
4. Éviter les formulations vagues comme « améliore l’entreprise ». Préférer un mandat mesurable, par exemple : « réaliser un diagnostic des contrôles du processus X, cartographier les risques, documenter les preuves et remettre un plan d’action priorisé ».
5. Cliquer sur **Transmettre l’instruction au COO IA**.
6. Lire le résultat affiché. Vérifier ensuite dans le portefeuille les missions créées et leur rattachement.

Une instruction ne signifie pas que toutes les actions seront automatiquement exécutées. Les décisions sensibles ou réservées restent soumises à approbation humaine. Une demande peut être refusée, limitée ou rester en attente si le moteur est désactivé, si l’autonomie ne le permet pas ou si une validation est nécessaire.

### 6.3 Créer une mission manuellement

Renseigner les champs :

- **Direction responsable** : direction opérationnelle qui porte la mission. Les fonctions indépendantes et humaines protégées ne sont pas proposées.
- **Agent responsable** : agent IA actif chargé de la mission. Choisir un agent cohérent avec le mandat et la direction.
- **Responsable opérationnel** : membre humain autorisé du workspace, si un suivi humain est requis.
- **Priorité** : 1 = critique / très haute ; 2 = haute ; 3 = normale ; 4 = basse ; 5 = très basse.
- **Intitulé** : titre court, précis et identifiable.
- **Objectif et livrables attendus** : résultat attendu, périmètre, étapes, preuves, format des livrables et critères d’acceptation.
- **Échéance** : date et heure cible.

Avant de cliquer sur **Créer la mission**, vérifier le rattachement, le responsable, la priorité, le contenu et l’échéance. La mission est inscrite dans la file durable existante. Sa création ne garantit pas son exécution immédiate : celle-ci dépend du worker, de l’état de l’agent et des paramètres du COO.

### 6.4 Suivre une mission dans le portefeuille

Chaque ligne de mission présente, selon les données disponibles :
- l’intitulé ;
- la direction ;
- l’agent ;
- le statut ;
- l’échéance ;
- la progression ;
- le résumé de l’agent ;
- les livrables ;
- les informations de revue indépendante ;
- les motifs de blocage ou de correction.

Le bouton **Dossier de contrôle** ouvre le détail complet de la mission. Le champ numérique de progression permet de saisir un pourcentage de 0 à 100, puis **Maj %** enregistre la mise à jour. La progression est un indicateur de suivi : elle ne constitue pas une preuve de réalisation ni une validation.

Le bouton **Copier** copie un état textuel du portefeuille, notamment les intitulés, directions, agents, statuts, priorités, progressions, échéances, objectifs, résumés, livrables et blocages. Vérifier le contenu copié avant de le diffuser.

### 6.5 Démarrer l’exécution des missions en attente

Le bouton **Démarrer l’exécution des missions en attente** déclenche le worker de manière contrôlée, une mission par appel. Il est réservé à la Preview et à la Direction générale selon le texte de l’interface.

Avant de lancer :
1. vérifier que les missions sont correctement définies et affectées ;
2. vérifier que l’agent responsable est actif ;
3. vérifier que le moteur COO est activé et que l’arrêt d’urgence n’est pas enclenché ;
4. vérifier qu’aucune validation humaine préalable n’est requise ;
5. s’assurer que l’exécution est autorisée dans l’environnement utilisé.

Après le lancement :
1. lire le résultat affiché ;
2. actualiser le portefeuille ;
3. vérifier le statut, le résumé, les livrables et les tâches ;
4. ouvrir le dossier de contrôle ;
5. ne pas relancer immédiatement si la première requête est encore en cours ou si le résultat est ambigu.

### 6.6 Dossier de contrôle d’une mission

Le dossier est accessible par **Dossier de contrôle**. Il comporte plusieurs zones.

**A. En-tête et synthèse de mission**  
Présente le titre, la direction, l’agent, le statut, la progression, l’état de la revue et le nombre de validations en attente. Un motif de blocage peut être affiché.

**B. Soumission de l’agent**  
Lire la synthèse, l’analyse, les livrables de mission et les résultats par tâche. Vérifier que les résultats sont concrets, spécifiques au mandat et cohérents avec les critères de réussite. Un texte générique ou une simple affirmation d’achèvement ne suffit pas.

**C. Revue indépendante**  
Présente le verdict de la revue, l’identité ou le type du contrôleur, le modèle éventuellement indiqué, le score qualité, les contrôles qualité et les constats. Le contrôleur indépendant évalue la soumission ; il ne prend pas la décision de clôture.

Les constats peuvent comporter un code, une sévérité, une description et des citations de preuve. Lire chaque anomalie et vérifier la traçabilité des citations.

**D. Tâches opérationnelles**  
Affiche les tâches rattachées, leur statut, leur progression, leur priorité et leurs éventuels blocages. Une mission terminée dont les tâches ne sont pas terminées présente une incohérence qui doit être corrigée.

**E. Historique de contrôle et validations**  
Présente les événements, les dates, les acteurs, les données de contrôle et les validations enregistrées. Cet historique sert à comprendre la séquence des actions et à conserver la traçabilité.

**F. Décision de la Direction générale**  
Cette zone n’est affichée qu’aux personnes habilitées lorsque les conditions le permettent.

- **Demander une correction et relancer** : saisir un motif précis d’au moins 8 caractères, puis cliquer. Décrire les éléments manquants, les preuves à fournir, les analyses à reprendre et les critères à respecter. La demande est journalisée et la mission retourne dans la file de traitement. La revue précédente est invalidée jusqu’à une nouvelle soumission et une nouvelle revue.
- **Valider et clôturer la mission** : action réservée à l’autorité habilitée. Le bouton n’est disponible que si la revue indépendante est acceptée. La clôture exige aussi que toutes les tâches attendues soient achevées à 100 % avec leurs livrables. Lire l’intégralité du dossier avant de confirmer.

Une revue indépendante acceptée n’est pas une clôture automatique. Une mission ne doit pas être clôturée si une preuve manque, si une tâche reste incomplète, si une anomalie bloquante demeure ou si l’approbation humaine requise n’a pas été donnée.

---

## 7. Directions — organigramme opérationnel

### 7.1 Finalité

L’onglet Directions présente les fonctions institutionnelles, leur nature, leur rattachement, leur mandat, leur responsable humain et/ou leur agent directeur.

La structure comprend des fonctions exécutives, opérationnelles, de contrôle, de support et des fonctions indépendantes ou réservées à l’autorité humaine. Les fonctions indépendantes et humaines ne relèvent pas de la chaîne de commandement du COO.

### 7.2 Lire une fiche direction

Chaque ligne peut présenter :
- le nom de la direction ;
- sa catégorie ;
- son rattachement hiérarchique ;
- le caractère opérationnel ou indépendant ;
- le responsable désigné ;
- le mandat ;
- l’état actif ou inactif.

### 7.3 Modifier un mandat

Pour une direction modifiable :
1. lire le mandat actuel ;
2. modifier le texte pour préciser la mission, les responsabilités, les limites et les livrables ;
3. cliquer sur **Enregistrer** ;
4. attendre la confirmation ;
5. actualiser et vérifier que le texte enregistré est toujours présent.

Un mandat doit rester institutionnel, précis et compatible avec la séparation des fonctions. Ne pas donner à une direction opérationnelle le pouvoir de valider ses propres travaux ou de neutraliser un contrôle indépendant.

### 7.4 Désigner les responsables

Pour les directions autorisées, sélectionner :
- un **Responsable humain** parmi les membres disposant d’un rôle approprié ;
- un **Agent directeur** parmi les agents actifs compatibles avec la direction.

Cliquer sur **Enregistrer** pour enregistrer le mandat et les responsables affichés. Éviter de désigner deux responsables incompatibles ou de confier une fonction indépendante à un agent opérationnel.

La Direction des Opérations (COO) est gérée par la Direction générale. Les fonctions protégées et la Direction générale ne sont pas modifiables comme des directions ordinaires.

### 7.5 Activer ou désactiver une direction

Le bouton **Activer / Désactiver** est disponible uniquement pour les directions éligibles. Avant de désactiver une direction, vérifier qu’elle ne porte pas de missions ou de tâches actives et prévoir leur réaffectation. Une direction indépendante ou humaine protégée ne doit pas être désactivée par le COO.

---

## 8. Tâches & affectations

### 8.1 Finalité

La tâche représente une unité de travail concrète, attribuable à une direction, à un agent IA et/ou à un collaborateur humain. Elle doit être suffisamment précise pour que son résultat soit vérifiable.

### 8.2 Créer et attribuer une tâche

Renseigner :

- **Direction** : choisir une direction active autorisée.
- **Mission associée** : sélectionner une mission de la même direction, ou choisir « Aucune » si la tâche n’est pas rattachée à une mission.
- **Agent responsable** : sélectionner un agent actif compatible avec la direction, ou « Non affecté ».
- **Collaborateur responsable** : sélectionner un membre humain autorisé, ou « Non affecté ».
- **Intitulé** : décrire l’action à réaliser.
- **Description / critères de réalisation** : préciser le périmètre, les étapes, les pièces attendues et les critères d’acceptation.
- **Priorité** : 1 critique, 2 haute, 3 normale, 4 basse, 5 très basse.
- **Échéance** : définir une date et une heure réalistes.

La sélection de la direction filtre les agents et les missions compatibles. Si une mission attendue n’apparaît pas, vérifier qu’elle appartient à la direction choisie.

Cliquer sur **Attribuer la tâche**. Le système enregistre et journalise la tâche. Vérifier qu’elle apparaît ensuite dans **Suivi des tâches**.

### 8.3 Mettre à jour le statut

Dans **Suivi des tâches**, utiliser la liste de statut de la tâche :

- **À faire** : travail non commencé ;
- **En cours** : travail commencé ;
- **Bloquée** : obstacle empêchant l’avancement ;
- **Terminée** : travail déclaré terminé ;
- **Annulée** : travail abandonné avec motif approprié dans le suivi opérationnel.

Ne choisir **Terminée** que lorsque le travail est réellement achevé et que le livrable attendu existe. Une tâche terminée peut encore nécessiter un contrôle de preuve ou une revue dans le dossier de mission.

Lorsqu’une tâche est bloquée, documenter le motif dans le processus de suivi approprié, identifier le responsable du déblocage et, si nécessaire, signaler l’alerte au COO.

### 8.4 Bonnes pratiques de découpage

Une mission complexe doit être découpée en tâches distinctes, par exemple :
1. cadrage et collecte des informations ;
2. analyse et vérification ;
3. production d’un livrable ;
4. contrôle qualité ;
5. consolidation et soumission.

Chaque tâche doit avoir un responsable, une échéance, une priorité et un résultat observable. Éviter les tâches trop larges telles que « faire toute l’étude ».

---

## 9. Alertes — centre de traitement

### 9.1 Types de situations signalées

Le centre d’alertes peut faire remonter :
- mission en retard ;
- mission en échec ;
- mission bloquée ou suspendue ;
- validation en attente depuis trop longtemps ;
- tâche en retard ;
- tâche bloquée.

Les alertes possèdent un niveau de sévérité, un titre, une description, une date et éventuellement un lien avec une mission ou une tâche.

### 9.2 Prendre en charge une alerte

1. Ouvrir l’onglet **Alertes**.
2. Lire le titre et la description.
3. Identifier la mission ou la tâche concernée.
4. Cliquer sur **Prendre en charge**.
5. Vérifier que l’état de l’alerte a été actualisé.

La prise en charge indique qu’un responsable s’occupe du sujet ; elle ne signifie pas que le problème est résolu.

### 9.3 Résoudre une alerte

1. Vérifier que la cause de l’alerte a disparu ou que le risque a été traité.
2. Vérifier le statut de la mission ou de la tâche concernée.
3. Cliquer sur **Résoudre**.
4. Actualiser le centre d’alertes.

Ne pas résoudre une alerte uniquement pour faire disparaître un signal visuel. Si la situation persiste, l’alerte peut être réouverte par le mécanisme de surveillance.

---

## 10. Reporting à la Direction générale

### 10.1 Finalité

Le reporting DG consolide les données opérationnelles et les présente sous une forme lisible, archivable et exportable. Il sert à informer la Direction générale sur les missions, tâches, directions, alertes, risques, décisions requises et qualité des données.

### 10.2 Générer un rapport

1. Ouvrir **Reporting DG**.
2. Vérifier le workspace.
3. Cliquer sur **Générer un rapport maintenant**.
4. Attendre la confirmation.
5. Vérifier si un nouveau rapport a été créé ou si un rapport identique existe déjà.
6. Consulter la liste des rapports archivés.

La génération peut être idempotente : si un rapport identique existe déjà pour la période, l’application peut indiquer qu’il n’a pas été recréé. Cela évite les doublons.

### 10.3 Consulter un rapport archivé

Cliquer sur **Consulter** à côté du rapport. Le détail contient notamment :
1. synthèse exécutive ;
2. performance par direction ;
3. missions à risque ;
4. alertes prioritaires ;
5. décisions et escalades ;
6. état des missions terminées vérifiées et non vérifiées ;
7. constats de qualité et de réconciliation des données.

Lire les limites de données et les anomalies avant de transmettre le rapport. Un rapport est un instantané des informations disponibles au moment de sa génération ; il ne remplace pas le suivi courant.

### 10.4 Copier ou télécharger

Dans le détail d’un rapport :

- **Copier** : copie le contenu textuel du rapport dans le presse-papiers.
- **Télécharger PDF** : produit un fichier PDF.
- **Télécharger Word** : produit un document Word modifiable.

Après export, ouvrir le fichier pour vérifier le titre, la période, les chiffres, les accents, les tableaux et les sauts de page avant diffusion.

### 10.5 Contrôles de réconciliation à lire attentivement

Le rapport peut signaler :
- missions terminées sans tâches opérationnelles ;
- missions déclarées terminées alors que des tâches ne le sont pas ;
- missions sans direction identifiable ;
- écarts entre le total des missions affectées et la somme des missions par direction ;
- écarts entre le total des tâches affectées et la ventilation par direction ;
- tâches rattachées à une direction différente de celle de leur mission.

Ces constats indiquent une anomalie de qualité ou de traçabilité. Ils doivent être investigués et corrigés à la source. Ne pas ajuster manuellement un chiffre dans le rapport pour masquer un écart.

### 10.6 Rapport automatique quotidien

Le paramètre **Rapport automatique quotidien** peut être activé ou désactivé dans les paramètres COO. La génération automatique dépend aussi du worker planifié et de la configuration de l’environnement. Une option activée dans l’interface ne constitue pas, à elle seule, une preuve que le cron est opérationnel dans un environnement Preview.

---

## 11. Paramètres COO — mandat, autonomie et sécurité

### 11.1 Accès et prudence

Les paramètres sont réservés au propriétaire pour l’enregistrement dans l’interface. Les changements affectent le fonctionnement du COO IA. Ne les modifier qu’après validation explicite de la Direction générale.

### 11.2 Agent COO désigné

Choisir l’agent actif prévu pour le rôle COO. Vérifier son identité avant l’enregistrement. Si aucun agent n’est désigné, ne pas supposer que le moteur peut orchestrer normalement.

### 11.3 Niveau d’autonomie

- **Niveau 1 — Proposer et planifier** : le COO prépare les propositions et plans ; les actions restent soumises aux validations et interventions prévues.
- **Niveau 2 — Déléguer les opérations réversibles** : le COO peut planifier et déléguer des opérations réversibles dans le périmètre autorisé.
- Le niveau 3 n’est pas proposé dans cette interface : il reste verrouillé jusqu’à la réussite de contrôles de sécurité et une décision distincte de la Direction générale.

Ne pas choisir le niveau supérieur disponible sans vérifier les délégations, les agents, les limites et les contrôles humains.

### 11.4 Activation du moteur

- **Activé** : le moteur COO peut fonctionner sous réserve des autres conditions.
- **Désactivé** : les nouvelles orchestrations sont désactivées.

La désactivation ne doit pas être confondue avec la suppression des données ou l’annulation des missions déjà enregistrées.

### 11.5 Arrêt d’urgence

L’option **ACTIVÉ — bloquer les nouvelles orchestrations** déclenche le coupe-circuit du COO. Elle doit être utilisée en cas d’incident, de comportement inattendu ou de risque de lancement non autorisé. Après activation :
1. ne pas relancer le worker ;
2. prévenir la Direction générale et le responsable technique ;
3. identifier les missions et actions en cours ;
4. documenter l’incident ;
5. ne désactiver le coupe-circuit qu’après autorisation et vérification.

L’arrêt d’urgence bloque les nouvelles orchestrations ; il ne doit pas être interprété comme une annulation rétroactive de toutes les opérations déjà engagées.

### 11.6 Rapport quotidien

Choisir **Activé** ou **Désactivé** selon la décision de gouvernance. Cliquer sur **Enregistrer les paramètres du COO IA**, attendre le message de confirmation et vérifier les valeurs après rechargement.

### 11.7 Enregistrer les paramètres

Avant de cliquer :
- confirmer l’agent COO ;
- confirmer le niveau d’autonomie ;
- confirmer l’état du moteur ;
- confirmer l’état du coupe-circuit ;
- confirmer l’option de rapport quotidien.

Après l’enregistrement, vérifier le message de succès et relire les valeurs affichées. En cas d’erreur ou de doute, ne pas répéter plusieurs fois sans vérifier l’état serveur.

---

## 12. Équipe & Gouvernance — espace lié

Le lien **Équipe & Gouvernance** ouvre un espace distinct de gestion de l’équipe, des agents et de la gouvernance du workspace. Il ne s’agit pas d’un onglet du poste COO.

Depuis cet espace, les utilisateurs autorisés peuvent accéder aux fonctions de gestion prévues par leur rôle, notamment les agents IA, les membres et les rôles. Les règles d’accès du workspace continuent de s’appliquer.

Avant d’inviter un membre ou d’activer un agent :
1. vérifier l’identité et le besoin d’accès ;
2. appliquer le principe du moindre privilège ;
3. attribuer le rôle approprié ;
4. vérifier que l’agent est rattaché à la bonne direction ;
5. ne pas attribuer de pouvoirs d’approbation humaine à un agent IA.

Ce manuel décrit le lien et son rôle dans le parcours COO, mais ne prétend pas remplacer une procédure détaillée de chaque écran de gestion de l’espace Équipe & Gouvernance, qui constitue un module distinct.

---

## 13. Procédures de bout en bout

### 13.1 Cycle normal d’une mission

1. La Direction générale définit un objectif et un mandat.
2. Le COO reçoit une instruction ou un utilisateur habilité crée une mission.
3. La mission est rattachée à une direction et à un agent actif.
4. Le travail est découpé en tâches avec responsables, priorités et échéances.
5. Le worker exécute les missions éligibles.
6. Les agents produisent une synthèse, une analyse et des livrables concrets.
7. Les résultats et preuves sont enregistrés.
8. Une revue indépendante examine la qualité, la traçabilité et les constats.
9. Si des corrections sont requises, le responsable demande une reprise motivée.
10. L’agent soumet une nouvelle version ; la revue indépendante est renouvelée.
11. Lorsque les critères sont réunis, l’autorité humaine examine le dossier.
12. L’autorité humaine décide de valider et clôturer, de demander une correction ou de rejeter selon les options disponibles.
13. Le rapport DG et le journal d’audit conservent la trace des opérations.

### 13.2 Traitement d’une mission en retard

1. Repérer la mission sur la Vue centrale ou dans les Alertes.
2. Ouvrir le Portefeuille et le Dossier de contrôle.
3. Identifier la tâche ou la dépendance à l’origine du retard.
4. Vérifier le responsable, l’échéance et le motif.
5. Réaffecter ou replanifier uniquement si l’utilisateur possède les droits et si le mandat le permet.
6. Documenter la décision et suivre l’alerte.
7. Ne résoudre l’alerte qu’après traitement de la cause.

### 13.3 Traitement d’une mission bloquée

1. Lire le motif de blocage.
2. Déterminer s’il s’agit d’une dépendance, d’un manque de données, d’un défaut d’agent, d’une validation attendue ou d’un problème technique.
3. Ne pas modifier arbitrairement le statut pour faire disparaître le blocage.
4. Affecter une action de déblocage à un responsable compétent.
5. Escalader à la Direction générale si une décision réservée est nécessaire.
6. Actualiser le dossier et suivre le résultat.

### 13.4 Traitement d’une anomalie de reporting

1. Ouvrir le rapport concerné.
2. Lire le constat exact de réconciliation.
3. Identifier les missions, tâches et directions concernées.
4. Ouvrir les dossiers sources.
5. Corriger le rattachement ou le statut à la source, selon les droits et les preuves.
6. Actualiser le reporting et générer un nouveau rapport si nécessaire.
7. Vérifier que l’écart a disparu et que l’historique reste explicable.

---

## 14. Bonnes pratiques de saisie et de qualité

### Une bonne instruction

Une instruction efficace précise : contexte, objectif, périmètre, directions impliquées, contraintes, échéance, livrables, preuves attendues et critères d’acceptation.

### Une bonne mission

Une mission possède un intitulé unique et compréhensible, un objectif mesurable, un responsable, une priorité justifiée, une échéance réaliste et des livrables vérifiables.

### Une bonne tâche

Une tâche décrit une action concrète, un résultat observable, un responsable, une échéance et des critères d’achèvement. Elle ne doit pas être un doublon d’une autre tâche.

### Une bonne revue

Le contrôleur doit pouvoir retrouver la preuve, comprendre le raisonnement, vérifier la cohérence des conclusions et distinguer les faits, les hypothèses et les recommandations.

### Une bonne clôture

Avant clôture, vérifier au minimum :
- objectif atteint ;
- livrables présents et exploitables ;
- tâches achevées ;
- preuves traçables ;
- revue indépendante acceptée ;
- constats bloquants traités ;
- validation humaine enregistrée par l’autorité habilitée.

---

## 15. Résolution des difficultés courantes

| Symptôme | Vérification et action recommandée |
|---|---|
| La page demande une connexion | Se reconnecter avec le compte membre du workspace. |
| Aucun workspace n’apparaît | Demander au propriétaire de vérifier l’invitation et l’adhésion au workspace. |
| Accès refusé | Vérifier le rôle et demander l’habilitation requise ; ne pas contourner le contrôle. |
| La vue ne se met pas à jour | Lire le message d’état, actualiser une fois, puis vérifier le serveur avant de répéter une action. |
| Un agent n’apparaît pas dans une liste | Vérifier qu’il est actif et rattaché à la direction sélectionnée. |
| Une mission n’apparaît pas pour une tâche | Vérifier le workspace et la direction de la mission. |
| L’exécution ne démarre pas | Vérifier l’état du moteur, le coupe-circuit, l’agent, l’éligibilité de la mission et les validations en attente. |
| La mission reste en attente de contrôle | Ouvrir le dossier, examiner la soumission et la revue indépendante ; ne pas forcer la clôture. |
| Le bouton de clôture est désactivé | Vérifier que la revue indépendante est acceptée, que les tâches sont terminées à 100 % et que le compte possède le droit de validation. |
| Une alerte réapparaît | Vérifier si la cause est toujours active ; une alerte peut être réouverte par la surveillance. |
| Le rapport ne se régénère pas | Vérifier si un rapport identique existe déjà pour la période. |
| Un export PDF ou Word échoue | Actualiser la page, vérifier le chargement du module d’export et réessayer une fois. |
| Les chiffres du rapport ne réconcilient pas | Traiter l’anomalie dans les données sources ; ne pas modifier le chiffre du rapport manuellement. |

En cas de panne persistante, conserver le message d’erreur exact, l’heure, le workspace, l’onglet, l’opération tentée et l’identifiant de mission ou de tâche. Ne jamais transmettre de mot de passe, de jeton ou de secret dans le signalement.

---

## 16. Sécurité, confidentialité et conservation

- Utiliser uniquement un compte personnel autorisé.
- Ne pas partager les identifiants de connexion.
- Se déconnecter ou protéger l’appareil lorsqu’il est partagé.
- Ne pas inclure de secrets, mots de passe ou clés API dans les contenus métier.
- Ne pas exporter ou diffuser un rapport à des personnes non autorisées.
- Vérifier les destinataires avant de copier ou télécharger un dossier.
- Respecter les rôles et la séparation des fonctions.
- Ne pas supprimer, désactiver ou réaffecter un élément sans comprendre ses dépendances.
- En cas d’incident, préserver les informations utiles et alerter la Direction générale / le responsable technique.

---

## 17. Liste de contrôle opérationnelle

### À chaque ouverture
- [ ] Bon lien COO et bon environnement.
- [ ] Connexion établie.
- [ ] Bon workspace sélectionné.
- [ ] Rôle affiché correctement.
- [ ] Vue centrale actualisée.

### Chaque jour
- [ ] Missions en retard et bloquées examinées.
- [ ] Tâches en retard et bloquées examinées.
- [ ] Alertes critiques prises en charge.
- [ ] Validations humaines en attente identifiées.
- [ ] Dossiers de mission prioritaires examinés.
- [ ] Reporting DG consulté ou généré selon la procédure.

### Avant toute exécution
- [ ] Mandat clair et autorisé.
- [ ] Direction et agent actifs corrects.
- [ ] Tâches et critères de réussite définis.
- [ ] Échéance et priorité cohérentes.
- [ ] Moteur activé et coupe-circuit inactif.
- [ ] Aucune approbation humaine préalable manquante.

### Avant toute clôture
- [ ] Synthèse et analyse examinées.
- [ ] Livrables concrets vérifiés.
- [ ] Toutes les tâches achevées et documentées.
- [ ] Revue indépendante acceptée.
- [ ] Constats bloquants traités.
- [ ] Décision humaine prise par l’autorité habilitée.

---

## 18. Gouvernance documentaire

Ce manuel décrit le fonctionnement de l’interface COO observé dans la version de l’application qui l’intègre. Si un écran, un bouton, un droit ou un processus évolue, le manuel doit être révisé et sa version mise à jour.

**Propriétaire du document :** Direction générale / Gouvernance & Conformité.  
**Responsable de mise à jour :** Documentation & Reporting, avec validation de la Direction générale.  
**Règle de diffusion :** utiliser la copie intégrée à l’application comme référence courante ; les copies téléchargées sont des instantanés et peuvent devenir obsolètes après une mise à jour logicielle.

**Fin du manuel.**
