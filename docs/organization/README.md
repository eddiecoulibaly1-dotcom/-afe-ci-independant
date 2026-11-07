# AFE-CI Autonomous Organization V1
## Référentiel organisationnel — point d'entrée

Ce dossier constitue le référentiel organisationnel directeur de la branche `feature/autonomous-organization-v1`.

## Documents normatifs

1. [Charte institutionnelle et référentiel directeur](./CHARTER.md) — mandat, organigramme fonctionnel, principes, séparation des responsabilités, droits de décision et règles de gouvernance.
2. [Manuel opératoire](./OPERATING_MODEL.md) — qualification des missions, affectation, Evidence Intelligence, cycle contradictoire, arbitrage, validation humaine et clôture.

## Ordre de mise en œuvre

| Lot | Périmètre | Critère de sortie |
|---|---|---|
| G0 | Charte et modèle opératoire | Responsabilités, incompatibilités et cycle approuvés |
| A1 | Contrats Evidence Intelligence, collecteur GitHub lecture seule, registre SHA-256, liaison constats-preuves, worker et tests | Collecte contrôlée, provenance reproductible, preuves vérifiables, reprise sûre |
| A2 | Missions et affectations | Mandat complet, rôles et indépendance contrôlés |
| A3 | Délibération contradictoire | Couverture complète, réponses et révisions persistées |
| A4 | Arbitrage indépendant | Décisions motivées par constat, dissensions conservées |
| A5 | Validation humaine | Approbation explicite, réserves et identité journalisées |
| A6 | Reporting et audit | Dossier final complet, exports et indicateurs |
| A7 | Durcissement et livraison | Tests, sécurité, preview et validation formelle |

## Règles de livraison

- Travailler exclusivement sur `feature/autonomous-organization-v1` pendant cette phase.
- Préserver `main` et toute Production : aucun merge, migration ou déploiement de production.
- Ne pas modifier le projet Supabase Production. Les opérations de données éventuelles doivent rester sur l'environnement de test explicitement autorisé.
- Chaque lot exige des tests et une revue avant de passer au suivant.
- Les contrôles CI/Preview sont des preuves de validation; un état pending ne vaut pas succès.
- Aucun document de gouvernance ne constitue à lui seul une incorporation juridique, une délégation de pouvoir réelle ou une autorisation d'action externe.

## État initial de ce dossier

- G0 — documentation de gouvernance : rédigée et enregistrée dans cette branche.
- A1 — fondations techniques Evidence Intelligence déjà présentes dans le code de la branche, mais leur audit exhaustif, les tests dédiés et la validation d'intégration restent à terminer.
- A2 à A7 — non déclarés terminés.

La progression est déclarée uniquement sur la base de fichiers relus, de tests exécutés et de validations observables.
