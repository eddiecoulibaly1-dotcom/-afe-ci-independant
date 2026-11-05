# BR-DEC-001 — Non-répétition et progression décisionnelle

**Statut :** exigence obligatoire  
**Priorité :** critique  
**Périmètre :** Architecte, Red Team, Arbitre et orchestrateur  
**Version d'introduction :** candidat V1.2.x

## Règles agent

Chaque tour doit apporter un élément nouveau et répondre explicitement aux objections précédentes. Une reformulation n'est pas une progression. Si aucun élément nouveau n'est disponible, l'agent doit le reconnaître et proposer un test discriminant. Les agents qualifient les faits vérifiés, hypothèses, inférences, affirmations contestées et informations manquantes.

## Arbitrage

Les scores sont des indicateurs auxiliaires. Ils ne déterminent plus mécaniquement le gagnant dans la couche de politique applicative : le moteur conserve le gagnant proposé par l'Arbitre et ajoute ses garde-fous de confiance. Un audit de preuve explicitement bloquant suspend la désignation d'un gagnant. Les contrôles quantitatifs déterministes existants continuent de suspendre l'arbitrage économique lorsque les entrées requises manquent.

L'Arbitre doit motiver sa décision à partir de la qualité des preuves, des objections, des risques et des conditions de faisabilité. Une décision conditionnelle ou suspendue est préférable à une certitude artificielle.

## Implémentation

- Les instructions système des trois agents intègrent BR-DEC-001.
- Les prompts Architecte et Red Team demandent de qualifier la progression par rapport aux tours antérieurs.
- Le prompt Arbitre interdit la sélection mécanique sur la seule base des scores.
- La politique applicative ne déduit plus le gagnant de l'écart de score.
- Un audit de preuve marqué bloquant force une décision suspendue et un statut non résolu.

## Limites et validation restante

La détection automatique de similarité sémantique entre contributions n'est pas encore implémentée ; la prévention actuelle repose sur les instructions aux agents et le contrôle de cohérence de l'arbitrage. Elle devra faire l'objet d'un lot séparé avec métriques, seuils calibrés et tests anti-faux-positifs.

La conformité doit être validée par typecheck, tests unitaires, tests d'intégration et essais de débats multi-tours (dont un dossier agricole), puis revue humaine des répétitions, des preuves et des décisions conditionnelles.

Aucune migration de base, fusion vers la branche principale ou promotion en production n'est incluse.
