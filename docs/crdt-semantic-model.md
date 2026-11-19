# Modèle métier CRDT ICARE — décisions retenues

Cette note formalise les arbitrages validés pour la première intégration métier des CRDT.

## Identité des répliques et des acteurs

- Une **réplique** correspond à une installation/appareil et possède un identifiant technique stable, conservé dans le stockage durable local.
- Un **acteur** correspond à une personne ou à un agent et reste une identité distincte.
- Chaque opération CRDT porte un dot `{ replicaId, counter }`, tandis que son attribution métier porte séparément l'acteur.
- Une personne utilisant plusieurs appareils produit donc des opérations depuis plusieurs répliques, toutes attribuables au même acteur.
- La génération du compteur doit être transactionnelle et persistée avant émission. Une réinstallation qui perd son stockage doit obtenir un nouvel identifiant de réplique ; elle ne doit jamais réutiliser l'ancien compteur à zéro.

Le module `replica.js` fournit les contrats d'identité et de dot. Il ne prétend pas encore assurer la persistance transactionnelle ni l'authentification.

## Politique de convergence par objet

| Objet ICARE | Représentation | Règle |
|---|---|---|
| Champs éditables d'une proposition | MV-register par champ | Les modifications concurrentes restent visibles ; une modification causale ne remplace que les versions observées |
| Observations | OR-set | Les contributions distinctes sont conservées ; un retrait ne retire que les ajouts observés |
| Relations | OR-set | Ajouts/retraits convergent sans effacer un ajout concurrent |
| Décisions de validation | Journal immuable représenté par OR-set | Les décisions opposées sont conservées et exposées comme divergence à traiter |

Les champs éditables sont explicitement listés dans `PROPOSITION_REGISTER_FIELDS`. Le statut de validation n'est volontairement pas un champ éditable de la proposition : accepter ou rejeter est un acte signé/attribué, justifié et historisé.

## Traitement des décisions concurrentes

Une décision contient un identifiant, un statut (`candidate`, `accepted`, `rejected`, `needs-review`), une justification, un acteur et une date. Deux décisions contradictoires ne sont jamais départagées par horodatage, priorité d'appareil ou ordre d'arrivée. Elles demeurent toutes deux dans l'historique jusqu'à un nouvel acte explicite de résolution.

Le CRDT garantit la conservation et la convergence des décisions, pas leur légitimité : l'autorisation de décider devra être vérifiée par la couche d'identité et de permissions.

## Tombstones

Les marqueurs de suppression OR-set ne sont pas purgés dans cette version. Aucune compaction n'est autorisée tant qu'un protocole de stabilité globale n'a pas prouvé que toutes les répliques autorisées ont observé les suppressions. Une réplique hors ligne ou retirée du réseau ne doit pas provoquer la réapparition d'un élément supprimé.

## Limites actuelles

- Ces contrats métier sont des structures pures et testées ; ils ne sont pas encore branchés sur les tables SQLite ni sur les routes d'échange.
- Le compteur de dots n'est pas encore persisté transactionnellement.
- La validation des droits et la signature des décisions restent à implémenter.
- Les opérations de suppression métier doivent être dotées et répliquées avant toute compaction.
- Les décisions concurrentes sont conservées ; l'interface de résolution humaine reste à construire.
