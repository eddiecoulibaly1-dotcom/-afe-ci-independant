# AFE-CI Debate Engine V2 — Integrated Preview

**État :** preview fonctionnelle intégrée, non promue en production  
**Branche :** `audit/hardening-v2-finalization`  
**Baseline protégée :** V1.0.7 / `main`  
**Version de plateforme V2 :** 2.0.0-preview

## 1. Accès

- Laboratoire historique : `/lab`
- Nouveau Decision Lab V2 : `/lab/v2`
- API : `/decision-cases`

La session Supabase existante (`afe-v09-session`) est réutilisée. Aucun jeton serveur ni secret fournisseur n'est envoyé au navigateur.

## 2. Capacités intégrées

- Création de cas de décision avec routage automatique ou mode débat / décision / hybride.
- Sélection et traçabilité des agents pertinents.
- Catalogue de modules spécialisés : stratégie, agriculture, finance, droit/conformité, gouvernance, risques/opérations/technologie. Le manifeste sélectionné injecte ses taxonomies, critères, guides de preuve et limites dans le contexte du cas.
- Graphe de preuves versionné dans le journal d'événements : affirmation, source, extrait, matérialité, note de qualité, contrôles et limites.
- Contrôle de source HTTPS : résolution DNS et blocage des adresses privées/locales, redirections non suivies, lecture bornée à 64 Ko ; si un extrait est fourni, recherche de cet extrait dans l'échantillon.
- Plan de falsification à partir des claims et objections du Red Team ; saisie du seuil préétabli et du résultat observé.
- Scénarios qualitatifs favorable, central et défavorable, sans prévisions numériques inventées.
- Registre des risques avec échelle probabilité × impact et classement.
- Interventions humaines et approbations owner/admin ; double contrôle pour les cas déclarés à enjeu élevé.
- Suivi post-décision des résultats et score de Brier pour les prévisions binaires documentées.
- Mémoire stratégique à validation humaine ; une leçon générale exige au moins deux cas sources accessibles du même espace.
- Rapport de décision et tableau de bord de métriques indépendantes.

## 3. Persistance et compatibilité

La V2 réutilise les tables existantes `debates` et `debate_events`. Les artefacts V2 sont ajoutés sous forme d'événements horodatés ; les routes historiques `/debates` et l'orchestration Architecte–Red Team–Arbitre restent disponibles. Aucune migration SQL n'a été exécutée pour cette livraison.

## 4. Sécurité

- Routes V2 protégées par l'authentification existante.
- Lecture contrôlée par les droits du cas ; écriture réservée au propriétaire ou aux rôles owner/admin/editor du workspace.
- Approbation réservée à owner/admin.
- Les partages en lecture seule ne peuvent pas écrire dans le cas.
- Les URL source ne sont jamais suivies en redirection automatique ; les adresses IP privées/locales sont rejetées.
- Le contenu fourni par les sources reste une donnée non fiable, jamais une instruction d'agent.

## 5. Interprétation des métriques

Les indicateurs sont séparés : couverture des claims, vérification du contenu, fiabilité documentaire (note explicitement fournie), couverture de falsification, robustesse des scénarios (notes explicites), intégrité du raisonnement, gouvernance et calibration des résultats.

Une valeur absente reste `null`. Une URL accessible ne vaut pas vérification du contenu. Une note de qualité saisie par un utilisateur n'est pas une validation indépendante. Le score global de qualité reste indisponible tant qu'au moins quatre composantes ne sont pas calculables.

## 6. Limites connues à la clôture de cette preview

1. Le noyau de génération continue d'utiliser l'orchestration Architecte–Red Team–Arbitre existante ; les services Evidence, Scenario et Risk sont déclenchés par les modules V2 et ne constituent pas encore trois fournisseurs autonomes supplémentaires.
2. Le contrôle d'extrait établit une correspondance textuelle dans un échantillon limité ; il ne certifie ni l'autorité de l'éditeur ni la vérité de l'affirmation.
3. Les scénarios sont qualitatifs ; une robustesse numérique n'est calculée que si des notes comparatives sont fournies.
4. La validation de mémoire est volontairement prudente et exige deux cas sources ; la recherche sémantique vectorielle cloisonnée n'est pas activée dans cette preview.
5. Les tests unitaires V2 sont ajoutés au dépôt ; leur exécution complète et les tests multi-utilisateurs/RLS restent à confirmer par le pipeline CI.
6. Les contrôles de restauration, sauvegarde et nettoyage des objets redondants de Production demeurent séparés et inchangés.

## 7. Déploiement

Le déploiement Vercel associé à la branche d'audit est un Preview. Aucun alias de production n'est promu, aucune migration n'est appliquée à la base Production et aucune modification n'est fusionnée dans `main`.
