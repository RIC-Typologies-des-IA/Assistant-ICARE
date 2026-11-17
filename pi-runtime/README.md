# Runtime ICARE avec Pi

Cette application est le premier runtime agentique d'ICARE. Pi est intégré au serveur Node.js via son SDK TypeScript/JavaScript ; Lemonade est le fournisseur de modèles local.

## Lancement

Depuis la racine du dépôt, après installation de Nix :

    nix --extra-experimental-features "nix-command flakes" run .

Le README racine fournit une commande unique qui installe Nix si nécessaire et lance directement cette application depuis GitHub. Le serveur écoute par défaut sur http://127.0.0.1:8765.

L'application suppose que Lemonade Server est déjà actif sur http://127.0.0.1:13305. Elle appelle GET /v1/models pour découvrir les modèles puis sélectionne le premier modèle portant le label chat. Pour forcer un identifiant précis :

    ICARE_MODEL="identifiant-exact" nix --extra-experimental-features "nix-command flakes" run .

Variables configurables :

- `LEMONADE_BASE_URL` : URL de base OpenAI-compatible, défaut `http://127.0.0.1:13305/v1`.
- `LEMONADE_API_KEY` : clé API si Lemonade est configuré pour en exiger une.
- `ICARE_MODEL` : identifiant de modèle chat exposé par `GET /v1/models`.
- `ICARE_HOST` : adresse d'écoute, défaut `127.0.0.1`.
- `ICARE_PORT` : port du serveur web, défaut `8765`.
- `ICARE_DATA_DIR` : dossier de données, défaut `~/.local/share/icare-pi/data`.
- `PI_CODING_AGENT_DIR` : configuration et sessions Pi, défaut `~/.local/share/icare-pi/pi-agent`.

Le premier lancement installe le SDK Pi depuis npm dans le dossier de données local. Nix fournit Node.js 24 et les outils nécessaires. Les dépendances npm du runtime sont épinglées dans package.json.

## Architecture

    Navigateur
       │ HTTP / SSE
       ▼
    Backend ICARE (Node.js)
       ├── Contrôleur HTTP et validation
       ├── SQLite : propositions, statuts, références
       ├── Outils ICARE explicitement autorisés
       └── Pi SDK (session et boucle agentique)
                 │ API OpenAI-compatible
                 ▼
             Lemonade Server
                 │
                 ▼
              Modèle local

Le modèle n'a pas d'accès aux outils intégrés dangereux de Pi. Le serveur utilise `noTools: "builtin"` et n'enregistre que les outils ICARE définis dans `src/server.js`. Aucun shell, navigateur, accès arbitraire au système de fichiers, MCP ou recherche Web n'est fourni au modèle.

## Outils ICARE fournis à Pi

- `get_exploration_state` : consulter l'état des cinq dimensions.
- `search_reference_documents` : rechercher dans le corpus documentaire local.
- `list_propositions` : consulter les propositions et leur statut.
- `propose_observation` : enregistrer une observation comme candidate, jamais comme fait accepté.

Le contrôleur conserve le dernier mot : les propositions attendent une validation humaine ; les statuts d'exploration sont modifiés explicitement dans l'interface. Les statuts « suffisamment explorée » et « non applicable » exigent une justification.

## Données et confidentialité

Les données sont locales dans `ICARE_DATA_DIR`. SQLite conserve les propositions, les statuts d'exploration, les relations futures et les documents. Les sessions Pi sont écrites dans le répertoire Pi isolé du runtime. Le serveur écoute sur localhost par défaut ; ne le publie pas sur un réseau sans ajouter au préalable authentification et protections adaptées.

L'application n'envoie pas les données à un service de recherche Web. Le modèle local reçoit les requêtes par l'API de Lemonade.

## Tests

    cd pi-runtime
    npm install --ignore-scripts
    npm test
    node --check src/server.js

Les tests vérifient la disponibilité de SQLite et la capacité de Pi à charger un modèle configuré avec le protocole OpenAI-compatible de Lemonade. Ils ne remplacent pas un test d'intégration avec un modèle local réel.

## Limites de cette première version

- Les sessions sont gardées en mémoire pendant l'exécution du serveur ; les données ICARE sont persistantes, mais la restauration automatique du fil de dialogue après redémarrage reste à implémenter.
- La mémoire documentaire est initialement textuelle et la recherche lexicale ; les embeddings et l'analyse visuelle ne sont pas encore branchés.
- L'interface est mono-utilisateur local ; pas encore de comptes, d'isolation multi-utilisateur ni de Discord.
- Les modèles Lemonade ne prennent pas tous en charge les appels d'outils. Il faut choisir un modèle de chat capable de function/tool calling pour exploiter pleinement les outils ICARE.
- Le statut d'une proposition, la confiance d'extraction et les qualifications restent révisables ; la confiance n'est pas une probabilité calibrée.

Ce runtime constitue une base d'implémentation à éprouver, pas encore une version de production.
