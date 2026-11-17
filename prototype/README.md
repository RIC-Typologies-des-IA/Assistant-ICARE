# Prototype ICARE

Prototype local autonome, sans dépendance Python externe.

## Lancer

Python 3.10+ :

    cd prototype
    python server.py

Puis ouvrir http://127.0.0.1:8765

La base SQLite et les fichiers sont créés dans prototype/data/ au premier lancement.

## Fonctionnalités disponibles

- Saisie d'une contribution et segmentation en propositions.
- Classification heuristique initiale sur les cinq dimensions ICARE.
- Qualification séparée de la temporalité, de la position évaluative, du statut pratique et du statut épistémique.
- Registre historisé des propositions.
- Ajout de documents textuels et d'images avec légende/description.
- Recherche dans le corpus documentaire.
- Création manuelle de relations entre propositions.
- État d'exploration indicatif et première suggestion de question.

## Embeddings locaux facultatifs

Sans configuration, la recherche documentaire utilise une recherche lexicale. Pour activer des embeddings vectoriels locaux avec Ollama :

    ollama pull nomic-embed-text
    ICARE_OLLAMA_URL=http://127.0.0.1:11434 ICARE_EMBED_MODEL=nomic-embed-text python server.py

Le texte, la légende et la description des images sont vectorisés. Cette version ne fait pas encore d'analyse visuelle du contenu des images : une légende ou une description est nécessaire pour les rendre interrogeables. Aucun service de recherche Web n'est utilisé.

## Limites de cette première version

- L'extraction est heuristique et ne mobilise pas encore de LLM. Les propositions doivent être relues.
- La confiance est une indication technique grossière, pas une probabilité calibrée.
- Les relations sont proposées comme pistes et confirmées manuellement.
- Les statuts « suffisamment exploré » et « non applicable » ne sont pas attribués automatiquement.
- La recherche vectorielle est facultative et locale.
- Pas encore de comptes utilisateurs, de séparation multi-investigations, de Discord ni de synchronisation.

L'objectif est de tester le modèle conceptuel et le cycle d'accumulation avant de choisir le runtime agentique.
