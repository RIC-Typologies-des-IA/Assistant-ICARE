# Scénario prototype — branches conversationnelles et comparaison

## Objectif
Vérifier le parcours complet dans l'application, de la conversation commune jusqu'à la comparaison de deux exécutions issues de branches différentes. Ce scénario est aussi exécuté par `browser/test/smoke.mjs` avec un fournisseur de dialogue et un moteur de scoring simulés.

## Données de départ
- Un projet ICARE neuf.
- Un échange initial réussi dans la conversation originale.
- Une réponse déterministe du fournisseur simulé et des scores présents pour les cinq dimensions ICARE.

## Parcours
1. Depuis le message utilisateur initial, créer une première branche expérimentale.
2. Attendre la fin de son exécution et vérifier que la branche est visible dans le sélecteur.
3. Revenir à la conversation originale et créer une deuxième branche depuis le même message source.
4. Attendre la fin de cette seconde exécution.
5. Ouvrir la comparaison et vérifier que deux runs distincts sont proposés, chacun associé à une branche différente.
6. Sélectionner explicitement ces deux runs et lancer la comparaison.
7. Vérifier que les deux dialogues et les deux radars indépendants sont rendus côte à côte.
8. Sur chaque branche, parcourir le slider jusqu'au début puis jusqu'au run : le radar doit exclure les scores futurs et ceux de la branche sœur.

## Critères d'acceptation
- Deux branches réellement créées à partir de la conversation originale.
- Deux exécutions persistées, avec des identifiants distincts.
- La comparaison ne sélectionne pas silencieusement le même run deux fois.
- Chaque carte affiche le message utilisateur, la réponse ICARE et son radar cumulatif.
- Le replay de branche conserve le contexte hérité, mais n'inclut ni les runs futurs ni les runs d'une branche sœur.
- Aucun message « Réponse impossible » durant le scénario.

Ce document décrit un prototype de validation fonctionnelle, pas une preuve de qualité sémantique du scoring ni une validation des moteurs locaux de l'utilisateur.
