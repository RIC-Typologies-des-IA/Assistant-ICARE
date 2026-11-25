# ICARE — Modèle formel des systèmes

Ce dossier inaugure un noyau de modélisation formelle destiné à décrire un système, vérifier ses propriétés et explorer ses évolutions **sans dépendre d'un LLM**.

## Intention

ICARE doit progressivement pouvoir répondre de façon reproductible à des questions telles que :

- quelles assertions sont enregistrées et avec quel statut ?
- l'état courant est-il cohérent ?
- quels invariants sont respectés ?
- une configuration souhaitée est-elle atteignable ?
- quelles trajectoires d'évolution satisfont les contraintes ?
- pourquoi un objectif est-il impossible ou non démontré ?

Le LLM pourra aider à proposer des assertions, des objectifs ou des actions. Il ne sera pas la source de vérité ni l'exécuteur de la logique formelle.

## Existing formal work

Le dépôt contient déjà un modèle TLA+ ciblé sur le contrôle d'accès aux projets : [`spec/ICAREProjectAccess.tla`](../spec/ICAREProjectAccess.tla), sa configuration TLC et le workflow [`icare-formal-model.yml`](../.github/workflows/icare-formal-model.yml). Ce modèle vérifie des invariants de sécurité pour un système concret. Le présent dossier vise un niveau complémentaire : définir un vocabulaire générique réutilisable pour décrire différents systèmes ICARE et, à terme, fournir un moteur d'interrogation déterministe. Il ne remplace pas TLA+ ni ce modèle existant.

## Documents

- [Spécification initiale v0.1](spec-v0.1.md) — vocabulaire, sémantique, état, transition, invariants, objectifs et requêtes.
- [Exemple de système fini](examples/finite-system.json) — petit modèle destiné à servir de fixture de test et d'exemple lisible.

## Principes de conception

1. **Sémantique explicite** : chaque terme formel possède une définition.
2. **Typage** : les sujets, prédicats, objets et actions respectent des types déclarés.
3. **Séparation des axes** : nature de l'assertion, statut épistémique et modalité ne sont pas confondus.
4. **Faits non connus ≠ faits faux** : l'absence d'une assertion ne vaut pas négation.
5. **État ≠ invariant** : une propriété vraie maintenant n'est pas automatiquement garantie dans les états futurs.
6. **Objectif ≠ possibilité** : un souhait peut être irréalisable.
7. **Possibilité ≠ nécessité** : une propriété vraie dans un futur accessible n'est pas vraie dans tous les futurs.
8. **Résultats reproductibles** : mêmes données, mêmes règles et mêmes limites de calcul donnent le même résultat.
9. **Pas de magie LLM** : toute conclusion du noyau doit être traçable à des assertions, règles et transitions.
10. **Évolution versionnée** : toute modification de sémantique nécessite une version et des tests de compatibilité.

## Statut

La version 0.1 est une **proposition de noyau conceptuel**, pas encore un moteur complet ni un langage stabilisé. Les choix restent amendables à partir de modèles concrets et de tests. La prochaine étape est un petit moteur de référence accompagné d'un oracle de tests, avant d'intégrer le modèle à l'interface ICARE.
