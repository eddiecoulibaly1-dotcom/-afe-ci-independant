# AFE-CI Autonomous Organization V1
## Manuel opératoire — missions, preuves, délibération et décision

**Version :** 1.0.0  
**Référentiel associé :** [Charte institutionnelle](./CHARTER.md)  
**Statut :** Procédure de référence pour la branche de développement

## 1. Fiche obligatoire de mission

Avant exécution, une mission doit préciser :
- identifiant unique et espace de travail;
- demandeur et autorité mandante;
- titre, objectif et contexte;
- périmètre inclus et exclusions;
- référentiels, dépôts et systèmes autorisés;
- critères de réussite et livrables;
- échéance et niveau de priorité;
- participants, mandats et arbitre indépendant;
- exigences de validation humaine;
- restrictions d'accès, de collecte et d'action.

Une mission incomplète reste en qualification et ne doit pas être exécutée.

## 2. Affectation et indépendance

Le Secrétariat affecte au minimum deux participants actifs distincts et un arbitre actif distinct de tous les participants. Les mandats sont enregistrés avant le début. L'affectation est refusée si un participant est également désigné arbitre. Les conflits d'intérêts, indisponibilités ou changements d'affectation sont journalisés.

## 3. Collecte Evidence Intelligence

### 3.1 Autorisation
Chaque demande de collecte doit être rattachée à une mission et inclure dépôt, référence, commit attendu, chemin et plage de lignes facultative.

### 3.2 Contrôles préalables
Le collecteur :
1. vérifie le dépôt et la référence dans les allow-lists;
2. refuse les chemins absolus, traversées `..`, séparateurs anormaux, fichiers secrets et chemins hors préfixes autorisés;
3. résout la référence vers un commit;
4. compare le commit résolu au commit demandé;
5. lit le contenu en mode lecture seule;
6. applique les limites de taille et la rédaction des secrets;
7. calcule l'empreinte SHA-256 sur une représentation canonique documentée;
8. enregistre l'artefact et sa provenance.

Si la référence a avancé, la collecte est refusée et la demande doit être actualisée. Le système ne doit pas présenter un contenu différent comme preuve du commit initial.

### 3.3 Registre
Chaque artefact conserve au minimum : identifiant, espace de travail, type de source, URI, dépôt, référence, commit, chemin, plage de lignes, empreinte, date, version du collecteur, mode d'accès, statut de vérification, extrait expurgé et métadonnées.

L'identifiant est déterministe pour une même représentation canonique. Une collision d'identifiant avec une empreinte différente est une erreur bloquante. L'accès à un artefact est limité à son espace de travail.

### 3.4 Qualification probante
La preuve est évaluée par rapport à un constat précis : soutient, contredit ou apporte seulement du contexte. Chaque relation exige une justification. Une source intègre mais hors sujet ne soutient pas le constat.

## 4. Construction des constats

Chaque constat contient :
- identifiant stable, titre et énoncé factuel;
- cause et contexte lorsque connus;
- gravité, probabilité, impact et justification de cotation;
- preuves citées et évaluation individuelle de leur relation;
- statut de vérification;
- limites et contre-arguments;
- recommandation et critères de clôture.

Les identifiants de preuves doivent exister dans le registre de la mission. Les références inconnues sont rejetées. Un constat déclaré vérifié exige au moins une preuve de provenance vérifiée et une évaluation explicite de type `supports`. Une absence de preuve n'est jamais assimilée à une preuve d'absence.

## 5. Délibération contradictoire

### Tour 1 — Positions
Chaque participant produit une analyse autonome, sans prétendre répondre à une contribution antérieure. Les constats sont structurés et reliés aux preuves.

### Tour 2 — Contradiction
Chaque participant répond à une contribution précise d'un autre participant. Il doit identifier l'argument contesté, exposer son raisonnement et référencer les preuves pertinentes. Les répétitions sans apport nouveau sont signalées.

### Tour 3 — Révision
Chaque participant indique les éléments maintenus, modifiés ou retirés. Toute modification substantielle doit expliquer l'élément déclencheur : preuve, objection, règle ou correction factuelle.

### Contrôle de complétude
La couverture est calculée sur le produit participants × tours configurés. Une contribution manquante, invalide ou non persistée empêche l'arbitrage final. La mission reste reprenable; les contributions déjà enregistrées ne sont pas dupliquées lors d'une reprise.

## 6. Arbitrage

L'arbitre reçoit le dossier consolidé, les preuves, les évaluations, les contributions et les dissensions. Il rend une décision par constat :
- `upheld` — confirmé;
- `partially_upheld` — partiellement confirmé;
- `rejected` — rejeté;
- `unresolved` — non résolu.

Chaque décision comporte une motivation, des identifiants de preuves effectivement liés au constat et les dissensions pertinentes. Une décision manquante, non motivée ou citant une preuve étrangère au constat est rejetée et devient non résolue. L'arbitrage demeure suspendu si la couverture des tours est incomplète ou si l'arbitre n'est pas indépendant.

## 7. Validation humaine

Le rapport arbitré est marqué comme nécessitant une revue humaine. Le validateur peut :
- approuver;
- approuver avec réserves;
- rejeter;
- demander une reprise ou des preuves supplémentaires.

La décision conserve identité, rôle, date, commentaire, réserves et périmètre approuvé. Sans décision humaine explicite, le rapport reste en attente. Une réponse de modèle ou un statut technique `completed` ne vaut pas approbation.

## 8. Gestion des incidents et reprise

- **Source inaccessible :** enregistrer la limite, ne pas inventer de preuve.
- **Commit modifié :** suspendre la collecte, demander une nouvelle résolution.
- **Erreur de modèle :** conserver l'état, borner les tentatives et planifier une reprise.
- **Délibération incomplète :** garder l'état provisoire, lister les contributions manquantes.
- **Arbitre absent :** suspendre l'arbitrage et demander une affectation indépendante.
- **Preuve invalide :** rejeter la référence, conserver l'événement de rejet.
- **Conflit de données :** appliquer les règles serveur et journaliser le résultat.
- **Incident de sécurité :** bloquer l'opération concernée et escalader à l'autorité compétente.

## 9. Dossier final obligatoire

Un dossier clôturé comprend :
1. mandat et critères;
2. composition de l'équipe et contrôles d'indépendance;
3. journal des événements;
4. registre des preuves et limites de collecte;
5. constats et évaluations probantes;
6. contributions des trois tours;
7. rapport d'arbitrage et dissensions;
8. décision humaine et réserves;
9. recommandations, responsables et critères de suivi;
10. version des règles et des composants utilisés.

## 10. Contrôles d'acceptation avant toute clôture

- [ ] Mandat complet et périmètre autorisé.
- [ ] Participants distincts et actifs.
- [ ] Arbitre indépendant.
- [ ] Provenance et empreintes conservées.
- [ ] Aucun identifiant de preuve inconnu.
- [ ] Constats vérifiés soutenus par des évaluations explicites.
- [ ] Couverture complète des tours attendus.
- [ ] Réponses et révisions traçables.
- [ ] Une décision motivée par constat ou statut non résolu explicite.
- [ ] Validation humaine enregistrée.
- [ ] Dossier final complet et consultable.

Un seul contrôle bloquant non satisfait interdit de marquer la mission comme définitivement approuvée.
