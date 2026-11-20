# Contrat d'adaptateur d'inférence ICARE

Statut : proposition de contrat initial, à implémenter dans le client WebAssembly.

## Objectif

Le moteur d'inférence est un service externe interchangeable. Le noyau ICARE ne connaît ni le fournisseur, ni son SDK, ni son mode d'hébergement. Il reçoit une requête normalisée et un adaptateur la traduit vers le service configuré.

Le partage Discord ne fournit pas l'inférence et ne détient aucune clé de fournisseur.

## Configuration logique

Une configuration locale d'inférence comporte :

- `id` : identifiant local stable de la configuration ;
- `label` : nom lisible par l'utilisateur ;
- `providerType` : identifiant d'adaptateur (`openai-compatible`, `ollama`, `lemonade`, `bittensor`, `browser-local`, etc.) ;
- `endpoint` : URL du service, si applicable ;
- `credentialRef` : référence vers un secret du coffre local, jamais la valeur du secret ;
- `model` : identifiant de modèle transmis au fournisseur ;
- `capabilities` : capacités vérifiées/déclarées ;
- `options` : paramètres spécifiques validés par l'adaptateur.

Cette configuration reste locale au navigateur. Le manifeste partagé peut éventuellement contenir une préférence non secrète (par exemple le nom du modèle attendu), mais jamais l'endpoint privé ni le credential sans consentement explicite.

## Interface normalisée

Le contrat conceptuel d'un adaptateur est :

```ts
interface InferenceAdapter {
  id: string;
  validate(config: InferenceConfig): Promise<ValidationResult>;
  listModels?(config: InferenceConfig): Promise<ModelDescriptor[]>;
  capabilities(config: InferenceConfig): Promise<InferenceCapabilities>;
  generate(
    request: InferenceRequest,
    config: InferenceConfig,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<InferenceEvent>;
}
```

`InferenceRequest` contient un identifiant de tâche idempotent, les messages/contextes, les outils autorisés et les contraintes de sortie. `InferenceEvent` normalise au minimum le début, les fragments de texte, les appels d'outils, les métadonnées d'usage, la fin et les erreurs. Le contrat doit préserver les événements natifs utiles sans rendre le noyau dépendant d'un fournisseur.

## Premier adaptateur

Commencer par `openai-compatible` afin de couvrir rapidement les services qui exposent une API de type chat completions ou responses. Ne pas présumer que toutes les implémentations sont identiques : les capacités (streaming, tools/function calling, JSON schema, vision) doivent être détectées ou déclarées et testées.

Les adaptateurs Ollama et Lemonade pourront réutiliser ce transport lorsqu'ils sont réellement compatibles. BitTensor / « Shoot » nécessite une vérification de son API et doit être implémenté par un adaptateur dédié si le protocole diffère. L'inférence navigateur sera un adaptateur distinct utilisant WebGPU/WebAssembly selon les moteurs retenus.

## Credentials et confidentialité

- Les secrets sont saisis par l'utilisateur et conservés dans un stockage local protégé autant que le navigateur le permet.
- Une référence de secret peut être persistée ; la valeur du secret ne doit jamais être sérialisée dans le projet, les CRDT, les événements partagés, les exports par défaut, les logs ou les messages Discord.
- Ne pas placer de clé API dans le code source, les variables compilées WASM, les URL ou les paramètres visibles.
- Les requêtes directes depuis le navigateur exigent que le fournisseur autorise CORS. Si ce n'est pas le cas, proposer un relais privé configuré par l'utilisateur ; ne jamais transformer le backend Discord en proxy d'inférence partagé par défaut.
- Afficher clairement à l'utilisateur quel service reçoit les données de contexte avant l'envoi.
- Chaque participant d'un projet partagé conserve son propre fournisseur et ses propres credentials.

## Gestion des tâches

Toute demande est persistée localement avant envoi. L'identifiant de tâche reste stable lors des tentatives. Les erreurs réseau et limitations temporaires sont reprenables ; les erreurs d'authentification et de configuration sont présentées sans boucle de retry. Un résultat n'est intégré qu'après enregistrement durable.

## Tests de conformité

Chaque adaptateur doit passer une suite commune :
- validation de configuration et erreur claire ;
- authentification sans fuite de secret dans les logs ;
- découverte/validation de modèles lorsque disponible ;
- génération non-streaming et streaming ;
- annulation via AbortSignal ;
- appel d'outil si la capacité est annoncée ;
- gestion des quotas, timeouts, erreurs réseau et réponses malformées ;
- vérification qu'aucun credential n'apparaît dans les objets sérialisés du projet ou les événements de synchronisation.
