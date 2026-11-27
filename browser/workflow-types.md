# Workflow ICARE — typage et composition

Le workflow est un graphe de calcul dirigé. Chaque étape expose une signature d'entrée et une sortie. La transcription audio est réalisée en amont et n'appartient pas au graphe : l'entrée externe `userMessage: Message` est déjà transcrite.

## Types de données

- `Message` : message utilisateur transcrit.
- `Document`, `DocumentSet` : document ou corpus de documents.
- `Query` : requête de consultation.
- `Context` : contexte de conversation/projet.
- `Text` : texte ordinaire.
- `Score`, `Number` : valeur numérique.
- `ScoreReport` : rapport structuré du scoring, incluant le score et ses dimensions.
- `LLMResponse` : réponse produite par le modèle.
- `Boolean` : valeur logique.
- `JSON` : objet structuré générique.
- `FinalOutput` : sortie terminale du workflow.

## Signatures de la première version

| Nœud | Entrées acceptées | Sortie |
|---|---|---|
| Scoring | Message, LLMResponse, Text | ScoreReport |
| LLM | Message, Text, ScoreReport, Context, Document, DocumentSet, JSON | LLMResponse |
| Consultation documentaire | Query, Message, Text, Document, DocumentSet, Context | Text |
| Transformation | JSON, Text, ScoreReport, LLMResponse | Text |
| Condition | Boolean, Score, ScoreReport, Number, Text | Boolean |
| Sortie | LLMResponse, Text, ScoreReport, Document, JSON | FinalOutput |

Les signatures décrivent le contrat de composition. Un moteur ou un outil ne doit être proposé dans l'éditeur que s'il est réellement enregistré dans les exécuteurs disponibles. La consultation documentaire représente l'outil de recherche documentaire ICARE.

## Règle de compatibilité

Une arête de données de (A) vers (B) est autorisée si le type produit par (A) appartient à l'ensemble des types acceptés par l'entrée de (B). Les conversions ne sont pas implicites. Un rapport de scoring ne se connecte donc pas directement à une entrée de consultation qui attend un texte ou une requête ; le rapport peut en revanche alimenter le LLM ou une condition.

Le validateur inspecte toute référence `step.input` qui désigne une autre étape et refuse les incompatibilités avant l'exécution. Les entrées externes (comme `userMessage`) ne sont pas des références à des étapes et restent valides.

## Exemples de composition

- Message → Scoring → ScoreReport → LLM → LLMResponse
- Message + Document → Consultation → Text → LLM
- Message → Scoring et Consultation (branches) → LLM avec les deux résultats
- LLMResponse → Scoring (évaluation de la réponse) → ScoreReport

## Exécution

La première version conserve le format `workflow.json` et le moteur actuel. L'éditeur graphique modifie les références de données et les transitions du workflow, tandis que le JSON demeure accessible pour les modifications avancées. Les workflows peuvent contenir des transitions conditionnelles et des erreurs gérées ; l'exécution reste bornée par `maxSteps` et le garde-fou de répétition du moteur.
