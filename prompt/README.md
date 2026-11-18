# Approche par prompt — ICARE

Cette approche est la forme initiale et légère d'ICARE : la méthode est portée principalement par les instructions données au modèle. Elle ne nécessite ni application dédiée, ni base de données, ni runtime agentique.

Elle conserve le même référentiel conceptuel, mais adapte la longueur et la forme du prompt à trois environnements d'utilisation. Les sources externes mobilisées par le projet sont recensées dans la [bibliographie ICARE](../REFERENCES.md).

## Les trois niveaux d'usage

| Niveau | Fichier | Usage |
|---|---|---|
| **Standard** | [ICARE_instructions_standard.md](ICARE_instructions_standard.md) | Agent configurable, instructions persistantes ou projet ChatGPT. Version la plus explicite et complète. |
| **Local** | [ICARE_instructions_locale.md](ICARE_instructions_locale.md) | Modèle exécuté sur une machine ou une infrastructure locale, avec un champ de prompt système. |
| **Web compacte** | [ICARE_prompt_web_compact.md](ICARE_prompt_web_compact.md) | Service web ou interface sans configuration persistante, avec un budget de contexte limité. |

En cas d'hésitation, commencer par **Standard**. Les trois fichiers sont des adaptations opérationnelles d'une même méthode, pas trois définitions différentes d'ICARE.

## Référentiel commun

Le document [ICARE_referentiel.md](../ICARE_referentiel.md), situé à la racine du dépôt, est le socle commun : finalité, posture maïeutique, cinq dimensions, pensée systémique et principes de qualité.

Lorsque l'environnement permet d'ajouter des documents de connaissance, joindre ce référentiel en complément du prompt. Le prompt reste utilisable sans lui, mais le référentiel apporte les nuances détaillées.

## Installation

### Projet ChatGPT ou agent configurable
1. Copier le contenu de [la version Standard](ICARE_instructions_standard.md) dans les instructions du projet ou de l'agent.
2. Ajouter [ICARE_referentiel.md](../ICARE_referentiel.md) aux fichiers de connaissance, si possible.
3. Démarrer une conversation en présentant le système ou la transformation à travailler.

### Modèle local
1. Copier [la version Locale](ICARE_instructions_locale.md) dans le champ de prompt système.
2. Ajouter le référentiel aux documents accessibles au modèle, si l'interface le permet.
3. Pour les conversations longues, sauvegarder et réinjecter une micro-synthèse.

### Interface web sans prompt système persistant
1. Copier [la version Web compacte](ICARE_prompt_web_compact.md).
2. La coller au début d'une nouvelle conversation.
3. Présenter le sujet et échanger normalement.

## Limites de cette approche

Le prompt oriente le comportement du modèle, mais ne garantit pas à lui seul la persistance structurée, la traçabilité, la validation déterministe des propositions ou la continuité entre plusieurs sessions. Ces limites motivent l'approche agentique présentée dans le README principal.
