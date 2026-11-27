# Modèle formel des conversations, exécutions et configurations ICARE

Cette spécification décrit **le fonctionnement interne de l'outil ICARE**. Elle est distincte de `formal-model/`, qui décrit le formalisme générique offert à l'utilisateur pour modéliser le système qu'il étudie.

## Langage retenu : TLA+

TLA+ représente un système comme un état mathématique et des actions qui font évoluer cet état. TLC explore ensuite un espace fini d'états et vérifie les invariants. C'est le choix naturel ici : le problème porte autant sur les transitions (créer une branche, figer une configuration, lancer une exécution, comparer deux résultats) que sur la structure des données. Le dépôt possède déjà TLC en intégration continue.

## Trois structures distinctes

Le modèle ne confond pas trois arbres qui ont des responsabilités différentes.

1. **Arbre des messages** — chaque message utilisateur possède un identifiant propre, un parent éventuel et une branche d'appartenance. Un message source peut être le point de départ de plusieurs branches. Les messages hérités ne sont pas copiés : une branche référence son message source.
2. **Arbre des conversations / exécutions** — une branche possède un parent, un message source et une configuration de référence. Une exécution (`Run`) est un objet distinct, doté de son propre identifiant et relié à une branche, un message prompt et une configuration. La réponse est le résultat de cette exécution ; elle n'est pas un nouveau pointeur vers la réponse d'origine.
3. **Arbre des configurations** — une configuration est un instantané immuable. Une évolution crée un nouvel identifiant enfant, relié à sa configuration parente. Une exécution référence exactement l'instantané qu'elle a utilisé.

Ces structures sont liées par des références explicites, mais ne sont pas fusionnées en un arbre unique.

## Règles structurantes

- Un identifiant de message, de branche, de configuration ou d'exécution n'est jamais réutilisé.
- Une branche est créée depuis un message existant et conserve un lien vers la branche parente.
- Une branche référence exactement une configuration ; cette référence est fixée à la création.
- Une exécution référence exactement un triplet : branche, message prompt, configuration.
- Une exécution terminée possède exactement une réponse.
- Une comparaison référence deux exécutions terminées et distinctes, portant sur le même message prompt.
- Deux exécutions peuvent légitimement produire le même texte. La différence formelle est leur identité et leur provenance, pas une obligation artificielle de produire des textes différents.
- Une comparaison ne doit jamais comparer deux fois la même exécution.
- Une configuration ne se modifie pas en place : on crée une nouvelle version dans l'arbre des configurations.

## Invariants vérifiés par TLC

`ICAREConversationForests.tla` définit le système et ses actions. Le fichier `ICAREConversationForests.cfg` fournit un univers fini pour l'exploration.

Les invariants couvrent notamment :
- l'unicité de l'appartenance de chaque message à une branche ;
- la cohérence des liens parent/source ;
- l'existence d'une configuration pour chaque branche ;
- la provenance unique de chaque exécution ;
- l'identité de la configuration réellement utilisée par l'exécution ;
- l'existence d'une réponse unique pour chaque exécution terminée ;
- l'impossibilité de comparer une exécution avec elle-même ou des prompts différents.

## Conséquence pour le futur modèle d'interface

L'interface devra sélectionner et comparer des **identifiants d'exécution**, jamais simplement deux bulles ou deux messages affichés. Pour un message source donné, elle pourra présenter les branches qui en dérivent, puis les exécutions réalisées dans chacune. Chaque panneau de comparaison devra lire le résultat de son propre identifiant d'exécution.

Le modèle ne prescrit pas encore la disposition visuelle. Il fixe d'abord les identités, les relations et les invariants que toute interface devra respecter.

## Limites de cette première version

Le modèle est volontairement minimal : il formalise les branches, les messages, les configurations et les exécutions, mais pas encore les politiques de sélection de réponse, les pièces jointes, le contexte documentaire, les appels d'outils, les reprises d'exécution ni la fusion de branches. Ces notions seront ajoutées seulement après avoir défini leurs sémantiques et leurs invariants.
