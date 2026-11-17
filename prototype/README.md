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

## Activer les embeddings et l'analyse par LLM local (facultatif)

Le prototype fonctionne sans modèle externe : recherche lexicale et extraction heuristique. Pour utiliser un modèle local via Ollama :

    ollama pull nomic-embed-text
    ollama pull qwen2.5:3b

Puis, depuis le dossier prototype :

    ICARE_OLLAMA_URL=http://127.0.0.1:11434 ICARE_EMBED_MODEL=nomic-embed-text ICARE_CHAT_MODEL=qwen2.5:3b python server.py

Sous PowerShell :

    $env:ICARE_OLLAMA_URL="http://127.0.0.1:11434"
    $env:ICARE_EMBED_MODEL="nomic-embed-text"
    $env:ICARE_CHAT_MODEL="qwen2.5:3b"
    python server.py

Les textes, légendes et descriptions sont vectorisés localement. Lors d'une analyse, les documents pertinents sont retrouvés et transmis comme références méthodologiques au modèle local. Le prototype n'effectue aucune recherche Web et n'appelle aucun service distant. Les images sont stockées ; leur légende/description est indexée. L'analyse visuelle automatique des images n'est pas encore incluse.

Si tu ajoutes des documents avant d'activer Ollama, ils resteront indexés lexicalement ; pour les vectoriser, réinitialise la base de test puis relance le serveur avec Ollama configuré, ou réimporte-les.

## Limites de cette première version

- Sans Ollama, l'extraction est heuristique et ne mobilise pas de LLM. Les propositions doivent être relues.
- La confiance est une indication technique grossière, pas une probabilité calibrée.
- Les relations sont suggérées comme pistes et confirmées manuellement.
- Les statuts « suffisamment exploré » et « non applicable » ne sont pas attribués automatiquement.
- Pas encore de comptes utilisateurs, de séparation multi-investigations, de Discord ni de synchronisation.
- Le prototype ne constitue pas encore un agent conversationnel complet : c'est un banc d'essai fonctionnel pour le modèle de données, la mémoire documentaire et le cycle d'accumulation.

L'objectif est de tester le modèle conceptuel avant de choisir le runtime agentique.
