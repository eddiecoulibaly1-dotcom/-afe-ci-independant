# AFE-CI Indépendant — prototype initial

Cette application est indépendante de Lovable. Elle fonctionne dans un navigateur moderne et conserve ses données dans le stockage local du navigateur sur cet appareil.

## Inclus
- Boutique avec produits et prix modifiables
- Commandes, statut de préparation et statut de paiement manuel
- Lots et effectifs d'élevage
- Stocks d'aliments et saisie de consommation
- Incidents de santé et mortalité
- Recettes et dépenses
- Tableau de bord et alertes simples
- Export/import JSON pour sauvegarder et restaurer

## Limites à connaître
Ce prototype ne synchronise pas les données entre plusieurs téléphones et ne contient pas encore de base de données en ligne, de comptes utilisateurs, de contrôle d'accès ou de paiement Mobile Money automatique. Avant l'usage commercial, il faudra ajouter un backend sécurisé et tester les flux.

## Démarrage
Ouvrir `index.html` dans un navigateur. Pour publier en HTTPS, le dossier peut ensuite être placé sur un hébergement statique tel que GitHub Pages. L'hébergement public ne rend pas les données locales partagées.
