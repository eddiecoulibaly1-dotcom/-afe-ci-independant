# ADR-ORG-001 — Positionnement d'AFE-CI comme organisation intelligente

- **Statut :** Adopté
- **Date :** 2026-11-07
- **Décideur produit :** propriétaire du produit
- **Référentiel :** `AFE_CI_INTELLIGENCE_ORGANIZATION_ARCHITECTURE.md`

## Contexte

AFE-CI a été initialement conçu comme moteur de débats contradictoires. L'ambition produit a évolué vers une organisation hiérarchique d'agents spécialisés, capable de recevoir des missions, planifier, déléguer, collaborer, produire des livrables, contrôler ses résultats et soumettre des décisions à l'utilisateur.

## Options examinées

1. Conserver le débat comme expérience principale et ajouter des fonctions organisationnelles.
2. Créer une application séparée de type entreprise, en dupliquant les services.
3. Faire évoluer AFE-CI en organisation intelligente, tout en conservant le débat comme capacité transversale.

## Décision

Option 3.

AFE-CI devient **AFE-CI Intelligence Organization**. Le point d'entrée principal est la mission confiée au Directeur général IA. Les directions et agents ont des bureaux numériques. Le Contradiction Lab est conservé comme sous-système indépendant et transversal.

## Conséquences positives

- Cohérence entre l'expérience utilisateur et l'architecture de délégation déjà engagée.
- Réutilisation des missions parent/enfant, dépendances, workers, événements et contrôle d'accès.
- Possibilité de composer des équipes selon la mission sans rigidifier l'organigramme.
- Conservation de la capacité historique de débat sans imposer un débat formel à chaque demande.

## Conséquences et contraintes

- Le modèle de domaine doit distinguer organisation, bureau, agent, rattachement, mission, affectation, message, livrable et revue.
- Les bureaux sont des vues de données persistantes; ils ne sont pas des agents ni des runtimes autonomes.
- Il faut auditer le schéma actuel avant d'ajouter des tables, afin d'éviter doublons et migrations destructives.
- L'interface doit être repensée autour du Siège, de l'organigramme, des bureaux, des missions et du pilotage.
- Les tests doivent démontrer la séparation des rôles, l'isolation workspace, l'idempotence et la reprise.

## Garde-fous

- V1.0.7 reste intacte.
- Aucun merge, déploiement Production ou changement de Production.
- Les migrations sont additives et TEST uniquement.
- Les fonctionnalités sont déclarées terminées uniquement après tests et preuves.
