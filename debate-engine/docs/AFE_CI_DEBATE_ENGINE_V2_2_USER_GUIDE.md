# Guide utilisateur — Débats AFE-CI V2.2

## Démarrer un débat d'audit

1. Ouvrir l'environnement Preview AFE-CI et se connecter avec un compte du workspace de test.
2. Ouvrir **Team & Governance → Débats**.
3. Si aucune mission ouverte n'existe, le formulaire propose automatiquement une mission de diagnostic préremplie. Vérifier/modifier le titre, l'objectif, le contexte et l'agent responsable.
4. Sélectionner au moins deux agents actifs et le nombre de tours (2 à 5).
5. Cliquer sur **Créer et rattacher le débat**.
6. Cliquer sur **Exécuter le worker maintenant**. Cette action est réservée au propriétaire/administrateur et traite la prochaine mission admissible de l'espace.
7. Ouvrir la délibération dans la liste, puis **Détails** pour consulter les contributions, le registre de preuves et les arbitrages.

## Lire le rapport

Le rapport présente les constats consolidés, leur statut de vérification, la cotation du risque, la justification, les relations entre preuves et constats, les contre-arguments, les doublons regroupés, les limites et les décisions d'arbitrage.

Les preuves de provenance et les preuves qui soutiennent une conclusion sont distinguées. Un constat sans preuve suffisante reste « non vérifié »; une cotation insuffisamment étayée reste « non cotée ».

## Copier et exporter

- **⧉ Copier le rapport** copie le rendu textuel complet dans le presse-papiers.
- **Télécharger Word (.doc)** télécharge un document HTML compatible Microsoft Word. Il ne s'agit pas d'un DOCX natif.
- **Exporter PDF** ouvre une version d'impression propre. Dans la boîte d'impression du navigateur, choisir **Enregistrer au format PDF**.

## Approbation humaine

Les arbitrages restent en statut « validation humaine requise » tant qu'un administrateur distinct du créateur de la délibération n'a pas approuvé ou rejeté le rapport. Cette action est journalisée. Le modèle ne peut pas approuver son propre arbitrage.

## Sécurité et périmètre

Cette livraison est destinée à Preview et au projet Supabase TEST. La collecte de preuves est en lecture seule et limitée aux dépôts, références et chemins autorisés. Aucune migration ou promotion vers Production n'est incluse dans cette livraison.
