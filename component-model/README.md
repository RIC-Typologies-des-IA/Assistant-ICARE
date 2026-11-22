# ICARE Component Model — WASI / WIT

Cette spécification définit le contrat commun visé pour les composants exécutables ICARE. Elle est introduite dans la PR #85 pour rendre explicites l'identité, le cycle de vie et les capacités des composants. Elle ne signifie pas que tous les composants existants sont déjà compilés en WebAssembly.

## Contrat commun

Chaque composant exécutable exporte obligatoirement l'interface WIT `lifecycle` :
- `describe()` fournit son identité, sa version et ses capacités requises ;
- `invoke()` est son point d'entrée métier normalisé.

Les mondes WIT (`component-base`, `component-with-context`, `component-with-inference`, `component-agent`) composent ce contrat commun avec les seules interfaces hôte nécessaires au composant. Un composant d'ontologie peut n'importer que le contexte ; un agent peut importer le contexte, l'inférence et la messagerie.

## Principe de sécurité

Le manifeste déclare des capacités demandées, pas des droits automatiquement accordés. Le runtime ICARE compare les demandes à la politique, puis ne lie que les interfaces autorisées. Une capacité non accordée n'est pas importée ou son appel échoue explicitement.

Les composants ne reçoivent :
- ni clé fournisseur ;
- ni accès réseau générique ;
- ni accès ambiant au système de fichiers ;
- ni accès direct aux secrets ou au stockage d'autres projets.

L'interface `inference-api` prend un alias de modèle et délègue l'opération au service d'inférence de l'hôte. En mode entreprise, cet hôte appelle le gateway distant ; en mode autonome, il appelle le fournisseur configuré. Le composant ne connaît jamais la clé ni l'URL amont du fournisseur.

## Frontière d'exécution

Le runtime WASI / Component Model est chargé de valider les imports, les versions et les ressources. L'hôte ICARE applique les permissions, les quotas, la portée projet et le consentement. Le gateway d'entreprise ajoute la frontière réseau distante et la gouvernance des fournisseurs.

WASI n'est pas, à lui seul, le système de permissions ICARE : les imports doivent être contrôlés par l'hôte et aucun accès réseau/fichier ambiant ne doit être exposé.

## Migration

1. Documenter les composants et leurs capacités.
2. Implémenter le runtime WebAssembly côté navigateur, livré avec la PWA (aucune installation utilisateur).
3. Migrer les composants exécutables vers WIT/WASM.
4. Maintenir des adaptateurs à capacités restreintes pour les composants historiques jusqu'à leur migration.
5. Ajouter des tests de conformité du manifeste, des imports et des refus de capacités.

La présente PR livre le contrat WIT initial et le gateway d'entreprise. Le runtime WebAssembly complet et la migration des composants sont des étapes ultérieures explicitement non revendiquées comme terminées.
