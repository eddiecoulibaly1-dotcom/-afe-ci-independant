# Audit technique — branche V2.1
>
> Date : 5 novembre 2026  
> Branche auditée : `feature/debate-engine-v2-1`  
> Commit observé : `1a3dcba8ef7c402fabfd2efc5288a80638ed505e`  
> Référence de comparaison : `build/debate-engine-v1-2-research-intelligence` (`954a7a1310d455b61b16f7fd1fddd7e5a28833eb`)  
> Statut : audit réalisé, corrections partielles isolées, intégration globale non approuvée.
>
> ## 1. Conclusion exécutive
>
> La branche V2.1 contient des évolutions utiles — orchestration durable, reprise des étapes, registre de décision, raisonnement quantitatif, moteur de risques et scénarios — mais elle ne constitue pas une base de fusion sûre pour BR-DEC-001.
>
> La comparaison Git la montre fortement divergente de la base V1.2 : **175 commits en avance et 97 commits en retard**. Une fusion globale risquerait d'importer des changements non audités et des migrations qui ne font pas partie du périmètre BR-DEC-001.
>
> ## 2. Constats bloquants
>
> ### 2.1 L'arbitrage peut encore être décidé par les scores
>
> Dans `src/engine.ts`, la fonction `winnerFromScores` et le seuil `DECISION_GAP` déduisent le gagnant de la différence entre `architectScore` et `redTeamScore`. La fonction `buildActionableDecision` utilise ensuite ce résultat pour fixer le gagnant et la décision.
>
> Cette mécanique contredit le principe BR-DEC-001 : les scores sont des indicateurs descriptifs et ne doivent pas remplacer l'arbitrage motivé de l'agent Juge. Le code V2.1 doit être aligné avant toute intégration.
>
> ### 2.2 Les tours précédents ne sont pas transmis à tous les agents
>
> L'Architecte reçoit l'historique dans `architectPrompt`. En revanche, les signatures et appels de `redTeamPrompt` et `judgePrompt` dans V2.1 ne reçoivent pas l'historique des tours précédents.
>
> La Red Team et le Juge ne disposent donc pas du même contexte longitudinal. Cela affaiblit la détection des répétitions, la réfutation cumulative et l'explication des révisions.
>
> ### 2.3 Les instructions du Juge autorisent encore une décision fondée sur l'écart de score
>
> `JUDGE_SYSTEM` indique de recommander l'option ayant le meilleur score lorsque l'écart est significatif. Cette instruction doit être remplacée par une règle d'arbitrage fondée sur les arguments, les preuves, les objections et les informations nouvelles.
>
> ### 2.4 Échec CI sur la qualification financière
>
> Le commit Blueprint `1a3dcba...` passe le typecheck, mais la suite échoue sur un test : `router respects an explicit mode and detects a complex financial decision`.
>
> La cause est identifiée dans `src/decision-intelligence.ts` : le classificateur reconnaît « investissement » mais pas le verbe « investir » ni un montant tel que « 50 millions FCFA ». Le run observé compte 55 tests réussis et 1 échec.
>
> Une correction isolée est préparée dans la PR brouillon #7 : détection des conjugaisons d'« investir », du capital/financement et des montants en FCFA, euros, USD ou dollars. Le typecheck et les tests de cette PR ont réussi sur le commit `b63e0bc20291d1e5ed6e5b7c0c12d73a74cb88fe`. Cette correction n'est pas encore intégrée à V2.1.
>
> ## 3. Constats complémentaires
>
> - `package.json` annonce la version `1.1.1`, tandis que `src/server.ts` déclare `1.1.2`.
> - Le fichier `.env.example` V2.1 présente un routage différent de celui du test BR-DEC-001.
> - Les variables Preview spécifiques de V2.1 observées sélectionnent Gemini pour l'Architecte, la Red Team et le Juge. Cette configuration peut servir à un test mono-fournisseur, mais elle ne correspond pas au protocole BR-DEC-001 OpenAI / OpenAI / Gemini.
> - Le workflow CI de V2.1 ne déclenchait les tests des PR que lorsque la cible était `main`. Son filtre a été étendu à `feature/debate-engine-v2-1` afin que les PR correctives ciblant cette branche soient validées.
> - Les statuts Vercel READY ne prouvent pas la validité des clés API ni la réussite d'un débat réel.
>
> ## 4. Correctifs et contrôles déjà effectués
>
> 1. Branche dédiée `feature/BR-DEC-001-decision-progression` conservée séparément, basée sur V1.2.
> 2. Variables Vercel Preview de BR-DEC-001 limitées à cette branche : Architecte OpenAI, Red Team OpenAI, Juge Gemini ; modèles par agent ; trois tours ; délais et modèles de secours.
> 3. Aucun environnement Production modifié.
> 4. PR #6 BR-DEC-001 maintenue en brouillon ; typecheck et tests de validation réussis sur le commit `b2487a067e1bb4d0218995f9e001ab342a0c7208`.
> 5. PR brouillon #7 ouverte pour la correction de classification financière V2.1 ; validation automatisée réussie sur son commit de tête.
> 6. Aucun merge vers `main`, aucune migration distante et aucune promotion en Production.
>
> ## 5. Plan d'assainissement avant intégration de V2.1
>
> 1. Intégrer la correction de classification financière après revue de la PR #7.
> 2. Aligner `buildActionableDecision` et `normalizeTerminalDecision` sur le gagnant explicite fourni par le Juge ; les scores ne doivent jamais sélectionner le gagnant.
> 3. Bloquer la désignation d'un gagnant lorsqu'une preuve critique est non étayée ou en attente de vérification.
> 4. Transmettre l'historique complet à la Red Team et au Juge dans l'orchestration synchrone et dans les étapes durables.
> 5. Ajouter les tests de non-répétition, de progression à chaque tour, de révision motivée et de suspension probatoire.
> 6. Exécuter la suite complète, les tests de reprise/idempotence Supabase et un vrai débat Preview avec fournisseurs réels.
> 7. Comparer les contrats API, les migrations et la persistance V2.1 avec V1.2 avant tout cherry-pick ciblé.
>
> **Décision d'audit :** V2.1 est exploitable comme branche de travail, mais **non approuvée pour fusion globale**. Les correctifs doivent rester isolés et être validés un par un. Production reste hors périmètre.
