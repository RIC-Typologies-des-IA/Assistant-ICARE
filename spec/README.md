# Modèle formel des conversations, exécutions, configurations et radars ICARE

Cette spécification décrit **le fonctionnement interne de l'outil ICARE**. Elle est distincte de \`formal-model/\`, qui décrit le formalisme générique offert à l'utilisateur pour modéliser le système qu'il étudie.

## Langage retenu : TLA+

TLA+ représente un système comme un état mathématique et des actions qui font évoluer cet état. TLC explore ensuite un espace fini d'états et vérifie les invariants. Le dépôt possède déjà TLC en intégration continue.

## Structures distinctes

1. **Arbre des messages** — identifiants propres, parenté et branche d'appartenance.
2. **Arbre des conversations et exécutions** — une branche dérive d'une branche parente à partir d'un message source ; une exécution possède son propre identifiant et référence sa branche, son prompt et sa configuration.
3. **Arbre des configurations** — les configurations sont des instantanés immuables ; une évolution crée une nouvelle version.
4. **Chronologie de branche et événements de scoring** — chaque branche possède une chronologie ordonnée de messages et une chronologie ordonnée d'exécutions. Les messages et exécutions hérités sont référencés dans ces chronologies, sans être copiés ni réattribués à la branche fille. Les scores sont des contributions rattachées à une exécution et à une dimension.

Ces structures sont liées par des références explicites, mais ne sont pas fusionnées en un arbre unique.

## Sémantique du replay

- La chronologie des messages d'une branche commence par le préfixe hérité de sa branche parente, arrêté exactement au message source du fork.
- La chronologie des exécutions hérite des exécutions de la branche parente dont le prompt se situe dans ce préfixe. Cette liste est figée au moment du fork.
- Les messages et exécutions ajoutés ensuite sont ajoutés à la fin de la chronologie de la branche concernée.
- Le slider parcourt les exécutions de la branche, dans leur ordre, et non un historique global du projet.
- À la position sélectionnée, le radar est recalculé à partir de toutes les contributions de scoring des exécutions du préfixe allant de la première exécution jusqu'à celle observée.
- Le cumul est calculé dimension par dimension. Une contribution n'est comptée qu'une fois ; une dimension sans contribution vaut zéro.
- Une branche fille hérite donc des scores des exécutions présentes au moment de sa création. Les exécutions ajoutées ultérieurement à la branche parente ne sont pas rétroactivement injectées dans la branche fille.
- Les exécutions des branches sœurs ne sont jamais incluses.

Le modèle représente le radar comme un vecteur de sommes par dimension. Le choix de l'échelle, de la normalisation graphique et de l'éventuel plafonnement relève de la présentation ; il ne doit pas modifier l'ensemble des événements inclus dans le calcul.

## Radar en comparaison

Chaque exécution conserve sa provenance. Son radar est calculé sur la chronologie d'exécutions de sa propre branche, jusqu'à cette exécution. Une comparaison de deux exécutions distinctes expose donc deux vecteurs indépendants : chaque dialogue est accompagné du radar correspondant à sa branche et à son point d'arrêt. Il ne faut ni réutiliser le radar global du projet, ni calculer un radar commun aux deux panneaux.

Deux exécutions peuvent répondre au même prompt et produire un texte identique ; leur identité, leur branche, leur configuration et leurs contributions de scoring restent distinctes.

## Invariants vérifiés par TLC

Le modèle vérifie notamment :
- l'unicité de l'appartenance de chaque message ;
- la cohérence des liens parent/source ;
- la présence d'un préfixe de chronologie valide pour chaque branche ;
- le gel des préfixes de messages et d'exécutions hérités au moment du fork ;
- la provenance unique de chaque exécution et l'appartenance de son prompt à la chronologie de sa branche ;
- l'unicité d'un score par exécution et par dimension ;
- l'existence d'une réponse unique pour chaque exécution terminée ;
- l'impossibilité de comparer une exécution avec elle-même ou des prompts différents ;
- le caractère branché et indépendant des deux radars présentés dans une comparaison.

## Conséquence pour l'interface

Le modèle d'interface devra :
- faire porter le replay sur la chronologie des exécutions de la branche active ;
- recalculer le radar au déplacement du curseur, en cumulant le préfixe visible ;
- isoler les scores des branches sœurs et les évolutions postérieures au fork ;
- afficher, dans chaque panneau de comparaison, le dialogue et le radar dérivés du même identifiant d'exécution.

Le modèle ne prescrit pas encore la disposition visuelle. Il fixe d'abord les identités, les relations et les invariants que l'interface devra respecter.

## Limites

Cette version formalise un cumul additif des contributions de scoring. Si le moteur métier utilise une autre opération d'agrégation (moyenne, maximum, pondération, oubli temporel), cette opération devra être explicitée dans le modèle avant de modifier le calcul applicatif. Les pièces jointes, le contexte documentaire, les appels d'outils, les reprises d'exécution et la fusion de branches restent hors périmètre.
