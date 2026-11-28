# AFE-CI Debate Engine — Cahier des charges technique V2.2

Version 1.0.0 · 6 novembre 2026 · Développement Preview uniquement  
Branche : feature/autonomous-organization-v1 · PR de référence : #10 (brouillon)

## 1. Mandat et contraintes

Faire évoluer le débat multi-agents existant vers un processus durable d'investigation, de collecte de preuves, de contradiction, de consolidation, d'arbitrage et de production de rapports lisibles.

Contraintes impératives : ne pas modifier main, V1.0.7 ou Production; ne pas exécuter de migration sur Supabase Production; ne pas promouvoir de déploiement; conserver une branche isolée; ne déclarer une fonctionnalité terminée qu'après tests sur Preview et preuves de validation.

Principes : le consensus n'est pas une preuve; l'absence de preuve ne démontre pas l'absence d'un contrôle; provenance/intégrité et pertinence/support sémantique sont deux évaluations distinctes; les désaccords sont conservés; les doublons sont consolidés sans perte; les actions sensibles restent soumises à validation humaine; les budgets, appels, tours et reprises sont bornés.

## 2. État de l'existant et écarts

La branche contient déjà les modules evidence.ts, deliberation.ts, arbitration.ts, orchestration.ts, les routes workspace-scoped et les tables afe_evidence_artifacts, afe_deliberations, afe_deliberation_contributions et afe_arbitration_reports. Le collecteur GitHub est en lecture seule, calcule un hash et expurge certains secrets. Le worker peut lancer plusieurs agents et un arbitre. L'UI présente une première vue de débat.

Écarts à fermer :
- la collecte dépend de demandes manuelles et peut être vide;
- le statut verified de l'artefact ne prouve pas que son contenu soutient sémantiquement un constat;
- la reprise peut recréer des artefacts et doit être idempotente;
- les constats identiques ne sont pas consolidés;
- la décision de l'arbitre doit être exhaustive et fondée sur des références pertinentes;
- la validation doit vérifier workspace, pertinence et relation preuve/constat;
- le rendu est principalement JSON brut et ne permet pas copie/Word/PDF;
- les tests de concurrence, crash/reprise, workspace isolation et E2E réel restent nécessaires.

## 3. Architecture cible et modules

| Module | Responsabilité | Sortie |
|---|---|---|
| Evidence Discovery | Planifier les sources selon la mission et les autorisations | plan borné |
| Evidence Collector | Lire dépôt, commits, fichiers, migrations, tests et CI | artefacts versionnés |
| Evidence Registry | Persister, dédupliquer et retrouver les artefacts | registre append-only |
| Evidence Assessment | Qualifier provenance, intégrité, pertinence et support | évaluations séparées |
| Finding Normalizer | Normaliser sujet, cause, mécanisme et conséquence | constats canoniques |
| Anti-Duplication | Détecter doublons et préserver les sources | groupes de constats |
| Contradiction Engine | Exiger objections, contre-preuves, réponses et révisions | graphe d'arguments |
| Risk Scoring | Coter risques inhérents/résiduels et confiance séparément | cotation expliquée |
| Adjudication Engine | Statuer sur chaque constat sans effacer les dissent | rapport d'arbitrage |
| Human Approval | Approuver, rejeter ou retourner les décisions sensibles | décision tracée |
| Report Renderer | Produire HTML/Markdown/Word/PDF | rapport lisible |
| Audit & Observability | Tracer acteurs, modèle, prompt versionné, durée, erreurs et hashes | journal corrélé |

Séquence : authentification et contrôle workspace → périmètre et budget → inventaire des sources candidates → collecte → évaluation de provenance → évaluation de pertinence/support → positions indépendantes → objections/contre-preuves → réfutations/révisions → normalisation/déduplication → cotation → arbitrage indépendant → contrôle de complétude → approbation humaine → rapport et exports.

## 4. Types TypeScript contractuels

```ts
type EvidenceProvenance = "verified" | "partial" | "unverified";
type EvidenceSupport = "supports" | "contradicts" | "context_only" | "not_assessed";
type FindingVerification = "confirmed" | "partially_confirmed" | "unverified" | "refuted" | "out_of_scope";
type FindingDecision = "upheld" | "partially_upheld" | "rejected" | "unresolved";
type ContributionKind = "position" | "objection" | "rebuttal" | "evidence_review" | "revision";
type RiskSeverity = "critical" | "high" | "medium" | "low" | "info" | "not_rated";

interface EvidenceArtifactV2 {
 id:string; workspaceId:string; deliberationId:string;
 sourceKind:"github_file"|"github_commit"|"migration"|"test_result"|"ci_run"|"preview_log";
 sourceUri:string; repository:string; ref:string; commitSha:string;
 path?:string; lineStart?:number; lineEnd?:number; contentSha256:string;
 collectedAt:string; collectorVersion:string; accessMode:"read_only";
 provenance:EvidenceProvenance; excerpt?:string;
 metadata:Record<string,string|number|boolean|null>;
}
interface EvidenceAssessment {
 evidenceId:string; findingId:string; support:EvidenceSupport;
 relevance:0|1|2|3; rationale:string; assessedBy:string;
 assessedAt:string; independentReviewRequired:boolean;
}
interface AuditFindingV2 {
 id:string; canonicalKey:string; duplicateOf?:string;
 title:string; statement:string; category:string; severity:RiskSeverity;
 likelihood:1|2|3|4|5; impact:1|2|3|4|5; rationale:string;
 evidenceIds:string[]; verification:FindingVerification;
 limitations:string[]; counterArguments:string[]; recommendation:string;
 ownerRole?:string; closureCriteria:string[]; confidence:number;
}
interface DeliberationContributionV2 {
 id:string; workspaceId:string; deliberationId:string; round:number;
 agentId:string; kind:ContributionKind; body:string; evidenceIds:string[];
 respondsTo?:string; idempotencyKey:string; createdAt:string;
}
interface ArbitrationDecisionV2 {
 findingId:string; decision:FindingDecision; rationale:string;
 evidenceIds:string[]; dissent:string[]; limitations:string[];
 closureCriteria:string[];
}
interface DebateReportV2 {
 schemaVersion:"2.0"; id:string; workspaceId:string; deliberationId:string;
 missionId:string; title:string;
 status:"human_review_required"|"approved"|"rejected";
 executiveSummary:string; scope:string[];
 coverage:{examined:number;inaccessible:number;excluded:number};
 contributions:DeliberationContributionV2[]; evidence:EvidenceArtifactV2[];
 findings:AuditFindingV2[]; decisions:ArbitrationDecisionV2[];
 unresolvedDisagreements:string[]; limitations:string[];
 riskMethodologyVersion:string; createdAt:string;
 approvedBy?:string; approvedAt?:string;
}
```

Règle centrale : ne pas réutiliser un seul champ verification pour trois questions. L'authenticité/provenance de la source, sa pertinence et le fait qu'elle soutienne ou contredise le constat doivent être qualifiés séparément. Une source lue et hachée n'est pas automatiquement une preuve qui confirme une affirmation.

## 5. Modèles de données Supabase

Conserver les quatre tables existantes et compléter, après inspection de Supabase TEST :

### afe_evidence_assessments
id UUID PK, workspace_id, deliberation_id, evidence_id, finding_id, support enum logique, relevance 0..3, rationale, assessed_by, assessed_at. FK composites workspace/deliberation; index finding/evidence.

### afe_audit_findings
id UUID PK, workspace_id, deliberation_id, canonical_key, title, statement, category, severity, likelihood, impact, verification, confidence, rationale, recommendation, owner_role, limitations JSONB, counter_arguments JSONB, closure_criteria JSONB, duplicate_of, created_at, updated_at. Unique (workspace_id, deliberation_id, canonical_key).

### afe_finding_evidence
workspace_id, finding_id, evidence_id, relationship, assessment_id; PK composite et FK workspace-scoped.

### afe_deliberation_runs
id UUID PK, workspace_id, deliberation_id, status, lease_token, lease_expires_at, attempt, checkpoint JSONB, idempotency_key, started_at, finished_at. Unique workspace/idempotency_key; reprise bornée.

### afe_report_exports (facultatif)
id, workspace_id, report_id, format, content_sha256, generated_at, generated_by, status. Ne pas stocker les fichiers si la génération à la demande suffit.

Sécurité SQL : RLS sur chaque table; révoquer anon/authenticated; accès serveur authentifié; FK composites; artefacts et journaux append-only; trigger UPDATE/DELETE; aucune policy permissive par défaut; tests inter-workspaces; SECURITY DEFINER interdit sauf justification et revue.

## 6. API HTTP

Base : /team/api/workspaces/:workspaceId. Auth Bearer Supabase, contrôle de rôle côté serveur, Cache-Control no-store. Les mutations sont idempotentes via Idempotency-Key.

| Méthode | Route | Rôle | Fonction |
|---|---|---|---|
| POST | /deliberations | editor | créer débat, participants, budget et périmètre |
| GET | /deliberations | viewer | lister |
| GET | /deliberations/:id | viewer | détails, contributions, preuves, constats et arbitrage |
| POST | /deliberations/:id/collect | editor | lancer/reprendre collecte |
| GET | /deliberations/:id/evidence | viewer | registre de preuves |
| POST | /deliberations/:id/evidence/:evidenceId/assessments | editor/worker | qualifier support/pertinence |
| GET | /deliberations/:id/findings | viewer | constats consolidés |
| POST | /deliberations/:id/arbitrate | admin/worker | arbitrage idempotent |
| POST | /deliberations/:id/approval | admin distinct | approuver/rejeter/retourner |
| GET | /deliberations/:id/report | viewer | rapport structuré |
| GET | /deliberations/:id/report.md | viewer | export Markdown |
| GET | /deliberations/:id/report.doc | viewer | document Word compatible |
| GET | /deliberations/:id/report.pdf | viewer | PDF serveur, ou impression PDF navigateur explicitement identifiée |

Chaque ressource est filtrée par workspace. Les IDs inconnus, les références inter-workspaces et les actions non autorisées sont refusés. Les erreurs de fournisseur ne doivent jamais être transformées en succès.

## 7. Règles métier détaillées

### Preuves et couverture
- dépôt, ref, commit et chemins strictement allow-listés; commit résolu avant lecture;
- aucune URL arbitraire, path traversal, fichier .env/secrets ou taille excessive;
- SHA-256 sur contenu canonique; redaction avant persistance;
- persistance idempotente par workspace/commit/path/plage/hash;
- panne source = lacune de couverture, jamais preuve d'absence;
- une preuve peut soutenir, contredire ou contextualiser;
- compter sources candidates, consultées, inaccessibles et exclues;
- Production est exclue des sources et de l'environnement de test.

### Anti-duplication
Normaliser Unicode, casse, espaces et ponctuation selon une version de règle. Clé canonique = catégorie + sujet + mécanisme + conséquence. Similarité sémantique = suggestion, pas fusion automatique si la portée diffère. Conserver IDs originaux, auteurs, arguments, preuves et dissent. Un constat maître référence les doublons.

### Contradiction
Tour 1 : positions indépendantes. Tour 2 : objections ciblées. Tours suivants : réfutation, demande de preuve ou révision. Chaque contribution doit apporter une information nouvelle et répondre à une contribution lorsque pertinent. Bloquer les répétitions quasi identiques. L'arbitre ne peut être le seul auteur du constat. Conserver les désaccords non résolus.

### Arbitrage
Exactement une décision par constat canonique. Décisions : upheld, partially_upheld, rejected, unresolved. Chaque décision motive le lien logique et cite les preuves pertinentes. Sans preuve pertinente, ne jamais déclarer un fait technique confirmé. Le nombre d'agents et les scores de modèle ne changent pas le statut de vérification. L'arbitre peut fusionner, reformuler, rejeter ou renvoyer en investigation.

### Risque
Probabilité et impact 1–5 justifiés séparément. Risque inhérent et résiduel séparés. Gravité technique démontrée séparée du risque d'assurance/documentation. Score brut = probabilité × impact; matrice versionnée. Confiance probatoire séparée de la gravité. Si données manquantes : non coté, avec motif; ne pas inventer de score.

### Approbation
Approbateur distinct de l'auteur pour les décisions sensibles; hash du rapport approuvé; toute modification invalide l'approbation. Décision, acteur, date et note journalisés. Aucun effet externe ni déploiement déclenché par le modèle seul.

## 8. Rapport lisible et exports

Écran dans cet ordre : titre/mission/espace/date/statut; synthèse; périmètre/couverture; indicateurs; constats consolidés; preuves liées avec source/commit/path/lignes/hash/relation; contributions, objections et réfutations; arbitrage et dissent; limites et éléments manquants; recommandations et critères de clôture; approbation humaine.

Actions : icône Copier le rapport avec retour accessible; Télécharger Word (DOCX si générateur validé, sinon DOC HTML compatible clairement nommé); Exporter PDF via rendu d'impression propre et window.print() si aucun générateur PDF serveur n'est installé. Ne jamais annoncer un téléchargement PDF direct lorsque seul le dialogue d'impression est ouvert. Tous les exports contiennent les mêmes informations que l'écran, accents et caractères spéciaux compris, sans secrets ni données hors workspace.

## 9. Critères de validation — Definition of Done

- Créer un débat avec 2–4 agents actifs et 1–5 tours.
- Exécuter les agents et l'arbitre côté serveur; fermeture navigateur sans perte.
- Collecter des sources autorisées et afficher la couverture.
- Reprise après crash sans doublon.
- Détecter les doublons sans fusion abusive.
- Une décision par constat; dissent conservé.
- Rapport lisible; copie, Word ouvrable et PDF sauvegardable.
- Approbation humaine visible et auditée.
- TypeScript strict, tests unitaires/intégration et E2E Preview verts sur le même commit.
- Tests RLS/workspace isolation, concurrence, lease expiré, stale token, panne fournisseur et exports.
- Aucun accès Production, aucune migration Production, aucun merge ni promotion Production.

## 10. Plan de tests obligatoire

1. Evidence : commit inconnu, ref interdite, path traversal, .env, secret simulé, taille excessive, lignes invalides, source indisponible, hash stable et doublon idempotent.
2. Support sémantique : source lue mais hors sujet; preuve contradictoire; contexte seulement; constat confirmé sans preuve supportante rejeté.
3. Workspace : lecture, liaison et export inter-workspaces refusés.
4. Délibération : agent inactif, bornes de tours, budget, contribution vide, réponse à une contribution inconnue.
5. Anti-répétition : paraphrase, réponse sans cible, répétition, répétition avec nouvelle preuve.
6. Anti-duplication : titres distincts/même mécanisme, sujets proches/portées différentes, conservation des liens.
7. Arbitrage : décision manquante/dupliquée, finding inconnu, preuve non liée, dissent non résolu.
8. Risque : score hors bornes, gravité sans preuve, confiance faible, résiduel manquant.
9. Concurrence : deux workers, lease unique, stale token refusé, rapport unique.
10. Reprise : panne après collecte/contribution/arbitrage sans duplication.
11. Exports : rapport long, accents, HTML échappé, nom de fichier sûr, clipboard indisponible, impression mobile.
12. E2E : mission → deux agents → débat réel → preuves → arbitrage → rapport → copie → Word → PDF → approbation.

## 11. Livrables et réception

Spécification versionnée; code et tests; migrations Supabase TEST uniquement après revue; audit RLS; CI; Preview READY sur le commit exact; rapport E2E avec preuves; rapport final listant tests réussis, échoués, non exécutés et limites.

**Règle de clôture :** ne jamais déclarer l'application réceptionnée tant que le débat réel E2E, la persistance, les exports et l'approbation humaine ne sont pas vérifiés sur Preview.


## 13. Notes d'implémentation de la livraison Preview

La branche implémente déjà plusieurs contrats de cette spécification :
- collecte GitHub automatique sur un manifeste de chemins allow-listés lorsque la mission ne fournit pas de demandes de preuves;
- persistance idempotente des artefacts et résolution des preuves réutilisées via les références de contributions/arbitrages;
- séparation provenance de source et support sémantique du constat;
- normalisation et consolidation prudente des constats proches;
- décisions d'arbitrage exhaustives et limitées aux preuves rattachées au constat;
- tours contradictoires ciblés, contrôle de répétition et conservation des raisons de rejet dans les limites du rapport;
- persistance des constats structurés dans une enveloppe versionnée du champ body des contributions, avec décodage à l'affichage;
- rapport lisible, copie, export Word HTML-compatible (.doc), impression PDF navigateur;
- endpoint de validation humaine avec séparation des tâches et journalisation;
- création d'une mission directement depuis l'écran Débats lorsqu'aucune mission ouverte n'existe.

Les tables de findings et d'évaluations de preuves dédiées décrites à la section 5 restent une évolution de schéma. Dans la livraison actuelle, les évaluations et constats sont conservés dans le contenu structuré versionné des contributions et dans le JSON de l'arbitrage existant. Cette solution évite une migration supplémentaire pendant la protection de la baseline; elle devra être normalisée en colonnes/tables dédiées avant un usage à grande échelle.

Le bouton PDF ouvre l'impression du navigateur; il ne constitue pas une génération PDF serveur. Le document Word livré est un fichier .doc HTML-compatible, et non un DOCX natif. Ces formats sont annoncés explicitement dans l'interface.
