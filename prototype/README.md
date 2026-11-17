# Prototype ICARE

Prototype local autonome, sans dépendance Python externe.

## Lancer

Python 3.10+ :

    cd prototype
    python server.py

Puis ouvrir http://127.0.0.1:8765

La base SQLite et les fichiers sont créés dans prototype/data/ au premier lancement. Le corpus initial situé dans prototype/reference/ (guide humain et schéma SVG) est chargé automatiquement dans la mémoire documentaire si la base ne contient encore aucun document.

## Fonctionnalités disponibles

- Saisie d'une contribution et segmentation en propositions.
- Classification heuristique initiale sur les cinq dimensions ICARE.
- Qualification séparée de la temporalité, de la position évaluative, du statut pratique et du statut épistémique.
- Registre historisé des propositions.
- Ajout de documents textuels et d'images avec légende/description.
- Indexation du corpus documentaire et recherche.
- Création manuelle de relations entre propositions.
- État d'exploration indicatif et première suggestion de question.

## Connecter un serveur local compatible OpenAI (Lemonade, etc.)

Le prototype utilise l'API HTTP compatible OpenAI. Lemonade expose cette API ; aucune bibliothèque Python supplémentaire n'est nécessaire.

Sur une installation Lemonade Server standard, le prototype utilise par défaut `http://127.0.0.1:13305/api/v1`. Vérifie les identifiants de modèles disponibles dans l'interface Lemonade ou avec `GET /v1/models` sur ton serveur. Les noms de modèles doivent correspondre exactement à ceux exposés par Lemonade. Si ton serveur utilise une autre adresse, surcharge `ICARE_API_BASE_URL`.

Exemple Linux, depuis le dossier `prototype` :

    export ICARE_API_KEY="lemonade"
    export ICARE_CHAT_MODEL="NOM_EXACT_DU_MODELE_CHAT"
    export ICARE_EMBED_MODEL="NOM_EXACT_DU_MODELE_EMBEDDING"
    python server.py

Si ton serveur ne demande pas de clé API, la valeur par défaut `lemonade` peut être conservée. Si une clé est configurée dans Lemonade, renseigne-la dans `ICARE_API_KEY`.

Tu peux aussi ne configurer que le modèle de chat : l'analyse LLM fonctionnera et la recherche documentaire restera lexicale. Pour activer la recherche sémantique, configure un modèle d'embeddings compatible et disponible dans Lemonade. Les modèles ONNX ne prennent pas tous en charge les embeddings ; vérifie la recette du modèle.

Pour vérifier les modèles exposés par Lemonade :

    curl http://127.0.0.1:13305/api/v1/models

Si ton installation utilise une autre adresse ou un autre port, adapte simplement `ICARE_API_BASE_URL`. Le prototype ne dépend pas du port de Lemonade et utilise ses routes compatibles OpenAI, pas les routes spécifiques à Ollama.

Sans `ICARE_API_BASE_URL` et `ICARE_CHAT_MODEL`, le prototype fonctionne en mode heuristique. Les documents pertinents sont retrouvés et transmis comme références méthodologiques au modèle local lors de l'analyse. Le prototype ne lance aucune recherche Web. Les images sont stockées ; leur légende/description est indexée. L'analyse visuelle automatique des images n'est pas encore incluse.

Si tu ajoutes des documents avant d'activer les embeddings, ils resteront indexés lexicalement ; pour les vectoriser, réinitialise la base de test puis relance le serveur avec le modèle d'embeddings configuré, ou réimporte-les.

## Limites de cette première version

- Sans modèle de chat configuré, l'extraction est heuristique et ne mobilise pas de LLM. Les propositions doivent être relues.
- La confiance est une indication technique grossière, pas une probabilité calibrée.
- Les relations sont suggérées comme pistes et confirmées manuellement.
- Les statuts « suffisamment exploré » et « non applicable » ne sont pas attribués automatiquement.
- Pas encore de comptes utilisateurs, de séparation multi-investigations, de Discord ni de synchronisation.
- Le prototype ne constitue pas encore un agent conversationnel complet : c'est un banc d'essai fonctionnel pour le modèle de données, la mémoire documentaire et le cycle d'accumulation.

L'objectif est de tester le modèle conceptuel avant de choisir le runtime agentique.
