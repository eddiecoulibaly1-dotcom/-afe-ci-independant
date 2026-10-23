# AFE-CI Debate Engine

Moteur d'orchestration qui transforme une question stratégique en décision progressivement testée, contradictoire, traçable et révisable.

## Pipeline

1. **Architecte — OpenAI** : construit une proposition structurée.
2. **Red Team — Gemini** : tente de falsifier la proposition.
3. **Arbitre — configurable** : compare les deux, accepte/rejette les claims et décide s'il faut converger ou lancer un nouveau round.
4. L'orchestrateur répète jusqu'à convergence ou limite de rounds.

Chaque round conserve la proposition, les attaques, la décision de l'arbitre et les désaccords critiques.

## Démarrage

Node.js 22+ est requis. Les clés API doivent rester côté serveur et ne doivent jamais être exposées au navigateur.

```bash
cp .env.example .env
npm install
npm run typecheck
npm run dev
```

Puis :

```bash
curl -X POST http://localhost:8787/debates/run \
  -H 'content-type: application/json' \
  -d '{"question":"Quel segment doit être le premier marché d’AFE-CI en Côte d’Ivoire ?"}'
```

Ou :

```bash
npm run debate -- "Faut-il lancer AFE-CI en B2B ou en B2C ?"
```

## Important

Une persistance locale JSON est fournie pour le prototype. Elle pourra être remplacée par Supabase/Postgres sans changer le contrat du moteur. Les clés OpenAI/Gemini sont lues depuis les variables d'environnement serveur.

## Versioning

Les modèles sont configurables par variables d'environnement afin de pouvoir les pinner et les changer sans modifier le code. Les sorties des trois rôles sont validées par JSON Schema avant d'être acceptées dans le graphe de débat.
