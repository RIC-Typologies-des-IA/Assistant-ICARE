# Assistant ICARE

Ce dépôt développe un assistant méthodologique fondé sur la démarche **ICARE**. L'objectif est de construire progressivement une représentation compréhensible, structurée et évolutive d'un système, à travers un dialogue maïeutique avec des humains et, à terme, avec d'autres agents.

## La démarche ICARE

ICARE est une grille de description d'un système articulée autour de cinq dimensions :

- **I — Intention / finalité**
- **C — Contexte / situation**
- **A — Action / opération**
- **R — Régulation / organisation** (une dimension combinée)
- **E — Évolution / temporalité**

Les cinq dimensions sont interdépendantes. Une information peut relever de plusieurs dimensions. ICARE ne doit pas devenir un questionnaire rigide : la démarche reste non linéaire et les questions sont choisies selon leur utilité pour la compréhension du système.

## Architecture conceptuelle visée

Le projet distingue plusieurs composantes :

1. **Ontologie ICARE** : concepts, dimensions, règles de qualification et relations.
2. **Ontologies complémentaires** : temporalité et états, positions évaluatives/modalités (souhaité, rejeté, possible…), statuts pratiques (proposé, décidé, engagé, réalisé…) et provenance/connaissance.
3. **Mémoire documentaire de référence** : documents pédagogiques destinés aux humains (textes, guides, schémas et images), indexés pour être retrouvés et utilisés comme contexte méthodologique par l'agent.
4. **Registre des propositions** : informations extraites des échanges, conservées avec leur source, leur temporalité et leurs relations.
5. **État d'exploration** : suivi des dimensions documentées, des lacunes, des incertitudes et des questions ouvertes.
6. **Contrôleur déterministe** : validation des propositions et des transitions ; le modèle propose, le système contrôle et enregistre.
7. **Interface conversationnelle** : à terme, dialogue humain et échanges avec des agents externes, notamment via Discord. Le cœur ICARE n'a pas vocation à naviguer sur le Web.

La mémoire documentaire et l'ontologie sont complémentaires : l'ontologie fournit une structure formelle contrôlable ; les documents en langage naturel et les schémas expliquent la démarche et enrichissent le contexte de compréhension.

## Démarrer le prototype

Un premier banc d'essai fonctionnel est disponible dans le dossier prototype/.

    cd prototype
    python server.py

Puis ouvrir http://127.0.0.1:8765

Voir prototype/README.md pour connecter un serveur local compatible OpenAI, notamment Lemonade, ainsi que les fonctions disponibles et les limites connues.

## État du projet

Le prototype actuel permet de tester :
- la catégorisation initiale sur les cinq dimensions ;
- la qualification temporelle, évaluative, épistémique et pratique ;
- l'accumulation de propositions dans SQLite ;
- l'ajout et la recherche de documents de référence ;
- l'utilisation facultative d'embeddings et d'un LLM local via Ollama ;
- les premières relations entre propositions et les pistes d'exploration.

Il s'agit d'un prototype de conception, pas encore de la version de production ni d'un agent autonome complet. Les choix de runtime (Pi, PydanticAI, DeepSeek Harness ou autre) restent ouverts et devront être évalués sur des tests communs.

## Conception et suivi

- Issue #4 — Stabiliser la méthode ICARE et instruire l'architecture
- Issue #5 — Formaliser les ontologies complémentaires

Les décisions méthodologiques communes doivent être explicites, versionnées et validées ; une correction locale issue d'une conversation ne modifie pas silencieusement la référence ICARE.
