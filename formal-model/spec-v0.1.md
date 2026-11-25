# Spécification initiale du modèle formel ICARE

Version : 0.1 — proposition fondatrice  
Statut : expérimental, à valider par des modèles et des tests

## 1. Objet et périmètre

Le dépôt possède déjà un modèle TLA+ spécialisé pour le contrôle d'accès aux projets (`spec/ICAREProjectAccess.tla`) vérifié par TLC en CI. La présente proposition ne le remplace pas : elle vise une couche de vocabulaire et de modèle de système plus générale, dont les exemples pourront être traduits vers TLA+ ou d'autres moteurs de vérification.

Le modèle formel représente un système par :

- un vocabulaire typé ;
- des assertions sur ce système ;
- un état courant ;
- des règles de dérivation ;
- des invariants ;
- des actions et une relation de transition ;
- des objectifs et des scénarios.

Le noyau doit pouvoir être exécuté indépendamment de tout modèle de langage. La présente version fixe le vocabulaire et les engagements sémantiques minimaux. Elle ne définit pas encore un langage complet de programmation ni un solveur général.

## 2. Trois axes distincts d'une assertion

Une assertion est un enregistrement formel, non une phrase libre. Elle sépare trois axes.

### 2.1 Nature (assertion kind)

Valeurs initiales :

- `FACT` : proposition descriptive sur le système ;
- `DEFINITION` : définition d'un concept ou d'un type ;
- `RULE` : règle permettant de dériver une proposition ;
- `CONSTRAINT` : condition de validité d'un état ou d'une transition ;
- `INVARIANT` : propriété exigée dans tous les états accessibles ;
- `GOAL` : propriété ou état visé ;
- `CAPABILITY` : action ou opération que le système peut réaliser ;
- `PROHIBITION` : action ou état interdit ;
- `OBSERVATION` : donnée constatée à une source et un moment donnés ;
- `HYPOTHESIS` : proposition à examiner, non assimilée à un fait accepté ;
- `EVENT` : événement situé dans une histoire ;
- `SCENARIO` : trajectoire ou séquence envisagée.

Ces catégories ne sont pas toutes des propositions logiques de même forme. Les règles, actions et scénarios sont des objets du modèle qui peuvent contenir ou référencer des propositions.

### 2.2 Statut épistémique

Le statut décrit ce que le modèle sait de la proposition, indépendamment de son type :

- `accepted` : retenue comme donnée du modèle ;
- `proposed` : proposée, en attente d'arbitrage ;
- `rejected` : rejetée explicitement ;
- `unknown` : aucune décision épistémique ;
- `derived` : obtenue par une règle, avec sa justification.

Le statut `accepted` ne signifie pas « vérité universelle » : il signifie que la proposition est prise comme prémisse dans le contexte/version du modèle.

### 2.3 Évidence de vérité

Pour ne pas confondre absence d'information et négation, une proposition peut porter deux marques indépendantes :

- évidence en faveur de la proposition ;
- évidence en faveur de sa négation.

La sémantique d'information à quatre états est :

| Soutien | Réfutation | Interprétation |
|---|---|---|
| absent | absente | inconnu |
| présent | absente | soutenu comme vrai |
| absent | présente | soutenu comme faux |
| présent | présente | contradiction documentée |

Une contradiction locale ne doit pas faire disparaître les autres conclusions du modèle. Les règles de résolution de conflits ou d'arbitrage sont hors du noyau 0.1.

## 3. Modalités

Les modalités portent sur la relation entre une proposition et un monde, un état ou une trajectoire.

- `ACTUAL` : vrai dans l'état courant ;
- `POSSIBLE` : vrai dans au moins un état accessible ;
- `NECESSARY` : vrai dans tous les états accessibles considérés ;
- `DESIRABLE` : exprimé comme objectif ou préférence ;
- `PERMITTED` : autorisé par les règles normatives ;
- `OBLIGATORY` : exigé par les règles normatives ;
- `FORBIDDEN` : interdit par les règles normatives.

Ces modalités ne sont pas interchangeables. En particulier, `DESIRABLE` n'implique pas `POSSIBLE`, et `POSSIBLE` n'implique pas `NECESSARY`.

## 4. Vocabulaire typé

Le modèle déclare des types, des entités et des prédicats.

Un prédicat est défini par une signature, par exemple :

`Depends(Component, Component) -> Bool`

Une proposition atomique est une application d'un prédicat à des termes typés, par exemple `Depends(A, B)`.

Le moteur doit rejeter ou signaler comme mal typée toute proposition dont les arguments ne respectent pas la signature. Les identifiants d'entités sont stables dans le périmètre du modèle.

## 5. État

Un état (s) est une interprétation des propriétés variables du système à un instant logique donné.

- Les propriétés présentes dans l'état sont évaluées relativement à cet état.
- Une propriété absente n'est pas automatiquement fausse ; elle peut être inconnue.
- Les faits historiques et événements ne sont pas mutés par une transition : ils sont ajoutés à l'historique.
- Les changements d'état sont représentés par des transitions explicites.

Un état courant est noté (s_0).

## 6. Actions et transitions

Une action (a) possède :

- une signature typée ;
- des préconditions (Pre_a(s)) ;
- des effets (Eff_a(s,s')) ;
- éventuellement un coût ou une préférence, dans une extension future.

La relation de transition est :

[
s \xrightarrow{a} s' \quad \text{ssi} \quad Pre_a(s) \land Eff_a(s,s')
]

Une transition est admissible si elle respecte les contraintes de transition et préserve tous les invariants déclarés comme obligatoires.

Le noyau ne doit pas inventer de transition. Seules les actions et règles déclarées peuvent générer des successeurs.

## 7. États accessibles et futurs

`Reachable(s0)` désigne l'ensemble des états atteignables depuis (s_0) par zéro ou plusieurs transitions admissibles.

Une trajectoire est une séquence :

[
s_0 \xrightarrow{a_1} s_1 \xrightarrow{a_2} \cdots \xrightarrow{a_n} s_n
]

Dans un modèle fini, l'exploration complète peut terminer si l'espace d'états est fini et que les états équivalents sont canonisés. Dans un modèle infini ou une exploration bornée, le moteur doit annoncer ses limites.

## 8. Invariants

Un invariant (I) est une propriété exigée de tout état accessible :

[
\forall s \in Reachable(s_0),\ I(s)
]

La vérification standard comprend :

1. (I(s_0)) ;
2. pour toute transition admissible (s \to s'), si (I(s)) alors (I(s')).

Cette vérification inductive permet de démontrer la préservation d'un invariant sans nécessairement énumérer tous les états. Une simple vérification de l'état courant ne suffit pas.

Types utiles d'invariants : structurels, cohérence, fonctionnels, sécurité, conservation et processus.

## 9. Objectifs et faisabilité

Un objectif (G) est atteignable s'il existe une trajectoire admissible depuis l'état courant vers un état qui satisfait (G) :

[
ReachableGoal(G) \iff \exists s \in Reachable(s_0),\ G(s)
]

Le résultat de recherche distingue :

- `SAT` : une trajectoire témoin a été trouvée ;
- `UNSAT` : l'absence de solution a été démontrée dans le périmètre complet défini ;
- `UNKNOWN` : la recherche n'a pas pu conclure (limite, abstraction ou ressource) ;
- `INVALID` : le modèle est mal typé ou mal formé ;
- `INCONSISTENT` : une contradiction pertinente est détectée selon les règles du modèle.

Une recherche bornée qui ne trouve pas de solution retourne `UNKNOWN`, pas `UNSAT`.

Le caractère souhaitable d'un objectif est une propriété distincte de son atteignabilité.

## 10. Questions déterministes du noyau

Le premier moteur doit viser les requêtes suivantes :

- évaluer une proposition dans l'état courant ;
- vérifier le typage et la cohérence structurelle ;
- vérifier un invariant dans l'état courant ;
- explorer les états accessibles dans un modèle fini ;
- vérifier la préservation d'un invariant ;
- chercher un témoin d'atteignabilité d'un objectif ;
- retourner une trace de preuve ou un contre-exemple ;
- expliquer une conclusion par les identifiants des prémisses et transitions.

Chaque résultat doit inclure le statut, le périmètre de calcul et les références qui le justifient.

## 11. Déterminisme et reproductibilité

Le noyau est déterministe si, pour une même version du modèle, une même requête et les mêmes limites :

- le résultat logique est identique ;
- l'ordre de parcours et de restitution est canonique ;
- les témoins et contre-exemples sont choisis par une règle stable ;
- aucune génération probabiliste ou appel LLM n'intervient dans la décision.

Le déterminisme ne signifie pas que le modèle est complet ni que ses prémisses sont vraies dans le monde réel. Il signifie que le calcul est reproductible à partir des données déclarées.

## 12. Hors périmètre v0.1

À définir ultérieurement : temporalité métrique, probabilités, préférences multi-objectifs, coûts, logique déontique complète, raisonnement causal, ontologies externes, abstractions, calcul distribué et gestion de versions sémantiques avancée.

La priorité est d'abord un moteur fini, petit et testable, avec des résultats explicables.
