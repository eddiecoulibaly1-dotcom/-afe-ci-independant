# Chapitre 16 — Autonomie totale et livraison end-to-end

## Objet

Ce chapitre transforme le mandat d'autonomie logicielle en règles exécutables et auditables. Il complète le moteur de débat : le système doit pouvoir transformer une décision de construire en un produit logiciel conçu, implémenté, testé, corrigé et livré dans les limites des accès réellement disponibles.

## Cycle obligatoire

1. **Intake** — reformuler l'objectif, identifier les utilisateurs, contraintes, exigences, exclusions et critères d'acceptation.
2. **Discovery** — examiner le dépôt, les dépendances, l'architecture, les environnements et les concurrents lorsque cela apporte une valeur réelle.
3. **Specification** — produire un périmètre versionné, les parcours, contrats, risques et critères testables.
4. **Architecture** — documenter les choix, alternatives, conséquences, flux de données, sécurité et plan de migration.
5. **Implementation** — travailler par lots cohérents sur une branche non productive, en préservant la baseline.
6. **Verification** — typecheck, tests unitaires, intégration, E2E pertinents, sécurité, non-régression et vérification des parcours.
7. **Staging** — publier uniquement dans un environnement de test autorisé et vérifier le comportement réel.
8. **Delivery** — remettre le produit, le code, les URL confirmées, la documentation, les preuves, les limites connues et les coûts.

## Matrice d'autorisation

| Catégorie | Règle |
| --- | --- |
| Lecture, audit, conception | Autorisée dans les accès disponibles |
| Modifications locales et branche de développement | Autorisées si réversibles et sans effet sur la production |
| Déploiement de prévisualisation/test | Autorisé uniquement dans un projet et environnement explicitement non productifs |
| Déploiement production | Approbation explicite obligatoire |
| Migration de base de données production | Approbation explicite, revue SQL et sauvegarde/restauration vérifiable obligatoires |
| Dépense, abonnement ou ressource facturable | Accord explicite après présentation du coût |
| Secret, compte ou permission supplémentaire | Intervention/autorisation du propriétaire requise |
| Action irréversible ou destructive | Approbation explicite obligatoire |

L'autonomie d'exécution n'est jamais une délégation implicite du pouvoir d'autorisation.

## Registre de preuves

Chaque artefact doit être distingué selon quatre états non interchangeables :

- **prepared** : contenu préparé mais non appliqué ;
- **executed** : opération réellement exécutée ;
- **verified** : résultat vérifié par une preuve observable ;
- **delivered** : artefact vérifié remis dans le livrable final.

Une compilation réussie ne prouve pas le fonctionnement métier. Un déploiement déclenché ne prouve pas que l'application est accessible. Une migration préparée ne prouve pas qu'elle est appliquée. Une sauvegarde d'un environnement local ne prouve pas qu'une base distante est sauvegardée.

## Conditions minimales de livraison

- exigences obligatoires reliées à des critères d'acceptation ;
- code et configuration versionnés ;
- tests exécutés et résultats traçables ;
- documentation utilisateur et technique ;
- configuration des secrets décrite sans divulgation des secrets ;
- persistance, authentification et autorisations vérifiées lorsque requises ;
- erreurs, limites, dépendances et coûts explicités ;
- URL et environnement vérifiés si un déploiement a été autorisé ;
- aucune modification de production non approuvée.

## Implémentation logicielle

Le premier socle exécutable est `src/autonomous-development.ts`. Il fournit :
- validation des exigences ;
- cycle de phases sans saut arbitraire ;
- garde d'autorisation par niveau de risque et périmètre exact ;
- registre des approbations ;
- registre de preuves préparé/exécuté/vérifié/livré ;
- contrôle de préparation de livraison.

Ce socle ne prétend pas remplacer les connecteurs Git, CI, hébergement ou base de données. Chaque action externe doit être confirmée par le résultat réel de l'intégration correspondante.
