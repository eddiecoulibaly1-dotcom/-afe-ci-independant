# Procédure opérationnelle — Centre d'alertes COO

**Version :** 1.0  
**Date :** 9 novembre 2026  
**Périmètre :** AFE-CI Autonomous Organization / COO

## 1. Principe directeur

Une alerte est un signal de risque ou de dysfonctionnement. Elle ne constitue pas, à elle seule, la preuve qu'une tâche ou une mission a été résolue. La clôture exige une condition déclenchante levée, un diagnostic, une action corrective, une preuve consultable et une vérification par une personne différente du responsable.

Le bouton « Résoudre » direct n'est plus un mode de clôture autorisé.

## 2. Cycle de vie

1. **Nouvelle** — l'application détecte une condition (tâche bloquée, mission suspendue, échéance dépassée, échec ou validation en attente).
2. **Prise en charge** — un membre habilité clique « Prendre en charge ». Il devient le responsable enregistré. Une échéance de traitement peut être indiquée.
3. **Diagnostic** — le responsable décrit la cause réelle, les éléments vérifiés et les dépendances.
4. **Correction** — le responsable consigne les actions à mener et leur exécution.
5. **Soumission à vérification** — le responsable joint une référence de preuve et résume le résultat. La condition déclenchante doit être levée.
6. **Vérification indépendante** — un autre membre habilité examine la preuve et la condition source. Il valide ou refuse avec une note motivée.
7. **Clôture** — seulement après validation indépendante.
8. **Réouverture** — si la condition réapparaît, l'alerte revient dans la file active ; le compteur de réouverture et l'événement système sont conservés.

## 3. Contenu minimal attendu

### Diagnostic
- décrire le fait observé, pas seulement reformuler le titre ;
- identifier la cause immédiate et, si possible, la cause racine ;
- préciser les données, tâches ou missions examinées ;
- indiquer les dépendances et personnes concernées.

### Plan correctif
- actions concrètes, dans l'ordre ;
- responsable et échéance ;
- résultat attendu et critère de réussite ;
- escalade nécessaire si le responsable ne peut pas agir.

### Preuve
La référence doit permettre à un vérificateur de retrouver le résultat : lien vers un document, identifiant de livrable, rapport, pièce archivée ou référence de tâche. Un simple texte « fait » n'est pas une preuve suffisante.

### Vérification
Le vérificateur doit :
- être différent du responsable enregistré ;
- vérifier la preuve et la condition d'origine ;
- confirmer que le problème n'est plus présent ;
- laisser une note motivée ;
- refuser et renvoyer en correction si un critère manque.

## 4. Règles automatiques

- Une alerte liée à une tâche bloquée ne peut pas être clôturée tant que la tâche est toujours bloquée ou conserve son motif de blocage.
- Une alerte liée à une mission bloquée ne peut pas être clôturée tant que la mission est suspendue ou conserve son motif de blocage.
- Quand le système ne détecte plus la condition déclenchante, il place l'alerte en attente de vérification ; il ne la clôture pas automatiquement.
- La soumission à vérification recontrôle la condition source.
- La vérification exige un responsable désigné, une preuve, un résumé et un vérificateur distinct.
- Si la condition réapparaît après clôture ou pendant la phase de vérification, l'alerte est rouverte et un événement système est inscrit.
- Les transitions sont enregistrées dans le journal d'activité de l'alerte.

## 5. Traitement des alertes existantes

Les alertes déjà présentes sont conservées. La migration initialise leur workflow sans supprimer leur contenu :
- statut historique `open` → workflow `new` ;
- statut historique `acknowledged` → workflow `assigned`, en reprenant le responsable connu si disponible ;
- statut historique `resolved` → workflow `resolved`.

Aucune alerte de test n'a été clôturée ou modifiée manuellement lors du déploiement du schéma.

## 6. Rôles et séparation des tâches

- Le COO et les membres autorisés peuvent opérer les alertes via l'API authentifiée.
- Le responsable de la correction ne peut pas vérifier sa propre résolution.
- La Direction générale conserve ses prérogatives de gouvernance et d'escalade.
- Les tables d'historique restent accessibles uniquement côté serveur ; aucun droit de lecture ou d'écriture direct n'est accordé aux rôles navigateur.

## 7. États techniques

| État | Signification |
|---|---|
| `new` | Nouvelle alerte |
| `assigned` | Responsable désigné |
| `diagnosing` | Diagnostic enregistré |
| `in_progress` | Correction en cours |
| `pending_verification` | Condition levée ou correction soumise, en attente de preuve / contrôle |
| `resolved` | Résolution vérifiée |
| `reopened` | Condition réapparue après clôture ou vérification |

Le statut historique (`open`, `acknowledged`, `resolved`) est conservé en parallèle pour compatibilité avec les indicateurs existants.

## 8. Contrôle de qualité

Une clôture n'est conforme que si les six points suivants sont vérifiables :
1. responsable identifié ;
2. diagnostic exploitable ;
3. action corrective documentée ;
4. preuve consultable ;
5. contrôle de la condition source ;
6. vérificateur distinct et note de validation.

En cas d'échec, l'alerte reste active ou retourne en correction. Ne jamais fermer une alerte pour améliorer artificiellement les indicateurs.
