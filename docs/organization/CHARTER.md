# AFE-CI Autonomous Organization V1
## Charte institutionnelle et référentiel directeur

**Statut :** Référentiel directeur de conception et d'exploitation  
**Version :** 1.0.0  
**Périmètre :** Branche `feature/autonomous-organization-v1`  
**Règle de changement :** Toute évolution doit être documentée, testée et approuvée. Aucun changement de ce référentiel n'autorise à lui seul une promotion en production.

---

## 1. Mandat

AFE-CI Autonomous Organization est une organisation numérique d'analyse, de contrôle, de contradiction, d'arbitrage et d'aide à la décision. Elle transforme une mission explicite en un dossier traçable comprenant des éléments de preuve, des constats, des analyses contradictoires, des décisions motivées et, lorsque cela est requis, une validation humaine.

L'organisation ne doit pas se réduire à une conversation entre modèles. Elle doit fonctionner selon des responsabilités séparées, des mandats explicites, des règles d'indépendance, des contrôles de qualité et un journal d'événements vérifiable.

## 2. Principes non négociables

1. **Séparation des fonctions :** l'auteur d'un constat ne peut pas être son arbitre final.
2. **Contradiction réelle :** la contestation doit répondre à des arguments identifiables et pouvoir modifier le constat initial.
3. **Preuve avant conclusion :** chaque constat présenté comme vérifié doit référencer des preuves connues, accessibles et explicitement évaluées.
4. **Intégrité de provenance :** source, dépôt, référence, commit, chemin, plage de lignes, date de collecte et empreinte SHA-256 sont conservés.
5. **Aucune preuve inventée :** un identifiant inconnu ou non autorisé est rejeté; il n'est jamais remplacé silencieusement.
6. **Incomplétude visible :** une contribution manquante, un échec de collecte ou un désaccord non résolu demeure visible et empêche une clôture artificielle.
7. **Arbitrage indépendant :** l'arbitre est distinct de tous les participants à la délibération.
8. **Validation humaine :** toute conclusion soumise à approbation demeure non approuvée tant qu'une personne habilitée n'a pas statué.
9. **Traçabilité :** les événements, changements d'état, décisions, réserves et approbations sont historisés.
10. **Sécurité par défaut :** moindre privilège, isolation des espaces de travail, secrets côté serveur et opérations externes limitées au mandat.
11. **Réversibilité contrôlée :** les livrables et changements doivent être versionnés; aucune opération irréversible n'est confiée à un agent sans autorisation explicite.
12. **Transparence épistémique :** faits, hypothèses, inférences, limites et recommandations sont distingués.

## 3. Organigramme fonctionnel

### 3.1 Direction générale / Autorité de gouvernance
- Définit le mandat, les priorités et le périmètre des missions.
- Désigne les responsables et habilitations.
- Statue sur les escalades et les conflits de compétence.
- Ne réécrit pas rétroactivement les conclusions techniques; toute instruction est journalisée.

### 3.2 Direction Risques & Contrôle
- Conduit le diagnostic indépendant dans le périmètre du mandat.
- Produit les constats, causes, impacts, cotations et recommandations.
- Référence les preuves et explique leur lien avec chaque constat.
- Révise ses positions à la lumière des objections recevables.
- Ne peut ni arbitrer son propre travail ni approuver définitivement son rapport.

### 3.3 Direction Gouvernance & Conformité
- Examine la conformité au mandat, aux règles, aux politiques et aux contrôles.
- Conteste les constats insuffisamment étayés, les raisonnements incomplets et les risques omis.
- Vérifie la qualité de la preuve, la proportionnalité des recommandations et les conflits d'intérêts.
- Peut demander une collecte complémentaire ou une reformulation.
- Ne peut pas supprimer un désaccord au seul motif qu'il est minoritaire.

### 3.4 Evidence Intelligence
- Collecte les sources autorisées en lecture seule.
- Vérifie l'identité de la référence et du commit avant collecte.
- Calcule les empreintes cryptographiques et conserve la provenance.
- Détecte les secrets et les données à exclure ou masquer.
- Distingue intégrité de la source et pertinence probante du contenu.
- Refuse les dépôts, références, chemins et tailles hors politique.

### 3.5 Secrétariat général des missions
- Enregistre le demandeur, l'objectif, le périmètre, les critères de réussite et les échéances.
- Affecte les participants et l'arbitre selon les règles d'indépendance.
- Suit les états, délais, reprises et pièces du dossier.
- Prépare le dossier de clôture sans altérer le contenu des contributions.

### 3.6 Arbitrage indépendant
- Intervient après la délibération contradictoire complète.
- Statue constat par constat : confirmé, partiellement confirmé, rejeté ou non résolu.
- Motive chaque décision et ne cite que les preuves reliées au constat.
- Conserve les opinions divergentes et les limites.
- Ne peut pas approuver le rapport au nom de l'autorité humaine.

### 3.7 Autorité de validation humaine
- Examine le rapport d'arbitrage et les pièces.
- Peut approuver, rejeter, approuver avec réserves ou demander une reprise.
- Identifie l'approbateur, la date, la portée et la justification.
- Une validation humaine ne doit jamais être simulée par un agent IA.

### 3.8 Audit qualité, Documentation et Infrastructure
- Audit qualité : complétude, cohérence, absence de doublons, qualité des citations et respect du processus.
- Documentation & Reporting : rapports, exports, index et archivage.
- Infrastructure & Sécurité : identités, rôles, isolation, journalisation, sauvegarde et disponibilité.

## 4. Cycle institutionnel d'une mission

1. **Enregistrée** — objectif, demandeur, périmètre et critères documentés.
2. **Qualifiée** — faisabilité, conflits d'intérêts, accès et risques évalués.
3. **Preuves en collecte** — sources autorisées et limites enregistrées.
4. **Analyse initiale** — Risques & Contrôle formule ses positions.
5. **Contre-analyse** — Gouvernance & Conformité examine et conteste.
6. **Révision** — les participants répondent aux objections et révisent ou maintiennent leurs positions.
7. **Arbitrage** — un arbitre indépendant rend des décisions motivées après couverture complète.
8. **Revue humaine** — le dossier est soumis à l'autorité compétente.
9. **Clôture** — décision humaine, réserves, actions et pièces sont archivées.

Les états provisoires et incomplets doivent être représentés explicitement. Un échec technique ne vaut jamais approbation.

## 5. Protocole contradictoire de référence

Le cycle nominal comporte trois tours :
- **Tour 1 : positions indépendantes.** Chaque participant expose sa position sans répondre à une contribution inexistante.
- **Tour 2 : contradiction.** Chaque participant répond à une contribution identifiable d'un autre participant; les objections doivent être argumentées.
- **Tour 3 : révision.** Chaque participant indique ce qu'il maintient, modifie ou retire, et pourquoi.

Le nombre attendu de contributions est calculé à partir des participants et des tours configurés. Le passage à l'arbitrage final est interdit si la couverture n'est pas complète. Les reprises sont idempotentes et ne doivent pas dupliquer les contributions déjà persistées.

## 6. Statut des preuves et des constats

- `verified` : preuve résoluble, provenance vérifiée et relation probante explicitement évaluée.
- `partially_verified` : éléments partiels ou relation probante incomplète.
- `unverified` : preuve absente, inaccessible, non concluante ou non vérifiée.
- `out_of_scope` : élément hors du mandat.

L'intégrité cryptographique démontre que le contenu collecté correspond à une empreinte donnée; elle ne démontre pas à elle seule la véracité ou la pertinence de ce contenu.

Un constat sans preuve suffisante ne doit pas recevoir artificiellement une cotation de risque. Si la probabilité ou l'impact ne peuvent être raisonnablement établis, ils restent non évalués avec justification.

## 7. Droits de décision et incompatibilités

| Fonction | Peut | Ne peut pas |
|---|---|---|
| Risques & Contrôle | Proposer et réviser un constat | Arbitrer son constat |
| Gouvernance & Conformité | Contester, demander des preuves | Effacer un désaccord |
| Evidence Intelligence | Collecter, hacher, qualifier la provenance | Déclarer seule un fait vrai |
| Arbitre indépendant | Décider sur les constats | Approuver humainement |
| Validateur humain | Approuver, rejeter, réserver, demander reprise | Réécrire sans trace le dossier |
| Secrétariat | Orchestrer et tracer | Modifier le fond d'une décision |

L'identité d'un agent, son mandat et ses habilitations sont liés à un espace de travail. Un agent ne peut pas s'attribuer des droits en modifiant son propre contenu de mission.

## 8. Gouvernance des données et sécurité

- Isolation stricte par espace de travail.
- Autorisations vérifiées côté serveur pour chaque opération.
- Secrets et clés exclusivement côté serveur.
- Collecte externe en lecture seule par défaut.
- Allow-lists explicites pour dépôts, références et chemins.
- Limites de taille, délais, reprises bornées et redaction des secrets.
- Journalisation des accès, collectes, décisions et changements d'état.
- Aucun déploiement, migration de production ou promotion automatique à partir d'une mission IA.

## 9. Mesure de performance

Les indicateurs de référence sont :
- taux de missions avec périmètre et critères complets;
- couverture des contributions attendues;
- taux de preuves résolubles et taux de collecte échouée;
- part des constats vérifiés, partiellement vérifiés et non vérifiés;
- taux de décisions arbitrales motivées;
- nombre et ancienneté des désaccords non résolus;
- taux de validations humaines avec identité et justification;
- taux de reprises, doublons et erreurs de synchronisation;
- incidents d'accès, d'isolation ou de fuite de secrets.

Aucun indicateur de productivité ne doit inciter à réduire les exigences de preuve ou à clôturer prématurément une mission.

## 10. Évolution du référentiel

Toute modification doit inclure : motif, portée, analyse d'impact, compatibilité, tests, décision d'approbation et journal de version. Les règles de séparation des fonctions, d'indépendance de l'arbitre, de preuve avant conclusion et de validation humaine ne peuvent être assouplies implicitement.

## 11. Statut d'approbation

Ce document établit le référentiel directeur de conception pour AFE-CI Autonomous Organization V1. Son ajout à la branche de développement ne constitue ni une validation juridique de l'organisation, ni une approbation de production, ni une délégation de pouvoir à une IA.
