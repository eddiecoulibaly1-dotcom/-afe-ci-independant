# Coordination des missions et reprise des workers — AFE-CI COO

**Périmètre :** AFE-CI Autonomous Organization / COO  
**Référence :** P1 — Dépendances entre missions, coordination des directions et fiabilité des workers

## 1. Déclarer les prérequis d'une mission

Dans le COO, ouvrir **Missions**, sélectionner une mission, puis consulter le panneau **Coordination des missions** du dossier.

- Ajouter un prérequis uniquement lorsque la mission cible est en attente ou suspendue.
- Choisir la mission dont le résultat doit être disponible en premier.
- Ajouter autant de prérequis que nécessaire ; tous doivent être terminés avec succès.
- Retirer un prérequis devenu inutile tant que la mission cible reste en attente ou suspendue.

Le système refuse les dépendances vers une mission absente de l'espace de travail, une mission en échec/annulée, une auto-dépendance ou un cycle. La base protège également contre les cycles concurrents.

## 2. États et déblocage

| Situation du prérequis | Comportement de la mission dépendante |
|---|---|
| En attente, en planification, en cours ou suspendue | Mise en pause avec motif `DEPENDENCY_BLOCKED` |
| Terminé avec succès | Le prérequis est satisfait |
| Échec ou annulation | La mission dépendante reste bloquée |
| Tous les prérequis sont terminés | Remise en file `queued` automatiquement |

Une mission ne peut donc pas commencer sur la seule base d'une promesse de livrable. Le statut `completed` du prérequis est nécessaire.

## 3. Coordination entre directions

Pour construire une chaîne de travail, créer les missions dans l'ordre logique puis déclarer leurs relations. Exemple :

1. Direction Documentation : constituer et référencer les pièces.
2. Direction Risques & Contrôle : analyser les risques à partir du dossier constitué.
3. Direction Opérations : exécuter les actions approuvées.
4. Direction Reporting : consolider les résultats vérifiés.

Les missions indépendantes peuvent avancer en parallèle. Seules les missions ayant un lien de dépendance attendent leurs prérequis. La dépendance ne remplace pas la responsabilité de chaque direction ni la validation humaine du COO/DG.

## 4. Fiabilité des workers

- Un worker obtient un bail exclusif de mission (*lease*) et le renouvelle toutes les 45 secondes.
- Le bail est renouvelé sur le serveur pour 180 secondes ; une erreur réseau isolée n'interrompt pas immédiatement le traitement.
- Avant d'enregistrer les livrables et de synchroniser les tâches, le worker vérifie qu'il possède toujours le bail.
- Un worker dont le bail a expiré ou a été repris ne peut pas publier un résultat obsolète.
- Les erreurs d'exécution sont reprises selon le champ `max_attempts` propre à la mission, avec un délai exponentiel plafonné à 15 minutes.

## 5. Reprise automatique des missions abandonnées

Avant chaque prise de mission, le worker exécute le reaper des baux expirés :

- mission encore sous son plafond de tentatives : retour en file avec délai de reprise ;
- plafond atteint : passage en échec terminal ;
- bail manquant sur une ancienne mission en cours : traité également comme expiré ;
- chaque reprise ou échec terminal génère un événement d'audit.

Le reaper traite au maximum 50 missions par passage global et 25 par passage limité à un espace de travail. Le worker Vercel planifié l'exécute périodiquement ; une reprise manuelle de worker l'exécute également.

## 6. Contrôles avant clôture

La coordination des prérequis ne clôture pas les missions. Les contrôles existants restent obligatoires : livrables concrets, revue indépendante, tâches opérationnelles terminées, puis décision humaine de clôture par la Direction générale lorsque requise.

**Règle de gouvernance :** une dépendance organise l'ordre d'exécution ; elle ne transfère ni la responsabilité du livrable ni le pouvoir de validation.
