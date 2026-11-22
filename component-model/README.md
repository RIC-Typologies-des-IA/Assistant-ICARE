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

La PR #85 a livré le contrat WIT initial et le gateway d'entreprise. Cette tranche ajoute le runtime navigateur et migre les premières règles métier ; la migration de l'ensemble des composants historiques reste progressive et n'est pas présentée comme terminée.

## État d'implémentation — première tranche runtime navigateur

La branche `feat/wasi-component-runtime` ajoute un premier chemin d'exécution vérifiable, sans prétendre que la migration générale est achevée.

### Chaîne de construction

- `@bytecodealliance/jco` est épinglé à la version `1.40.0` dans les workflows.
- `browser/scripts/build-components.mjs` produit le composant `.wasm`, puis le transpile en modules ES et module(s) Wasm core compatibles avec les navigateurs.
- Les artefacts sont générés pendant CI et le build GitHub Pages ; ils ne sont pas suivis dans Git.
- Le Service Worker précache le runtime, le registre, le module transpillé et son module Wasm core.

Les navigateurs savent exécuter WebAssembly core, mais pas instancier nativement le format Component Model. Jco transpile donc le composant vers des modules JavaScript et Wasm core exécutables dans le navigateur. Cette étape est explicitement une adaptation de compatibilité, pas une exécution native du binaire composant par le navigateur.

### Hôte ICARE et politique de capacités

- `browser/component-runtime.js` ne charge que les identifiants du registre versionné.
- Le chemin d'entrée est dérivé de l'identifiant et doit correspondre strictement à `./components/<id>/<id>.js`.
- Le manifeste retourné par `lifecycle.describe()` doit correspondre à l'identité épinglée dans le registre.
- Les capacités inconnues sont rejetées ; les capacités requises doivent être accordées par l'hôte.
- Le monde `component-base` n'importe aucune capacité et ne peut donc en déclarer. Le monde `component-with-context` lie explicitement `context-read` à un instantané JSON fourni par l'hôte. Les capacités d'écriture, de stockage, d'inférence et de messagerie restent bloquées jusqu'à la création et aux tests de leurs liaisons dédiées.
- Les payloads JSON sont bornés à 256 Kio et les identifiants de corrélation sont contrôlés à l'aller et au retour.
- Le runtime ne fournit aucun accès réseau, système de fichiers, secret ou stockage ambiant.

Le composant `ontology-validator` porte la validation déterministe des observations, relations et statuts d'exploration ICARE. Le composant `context-summary` démontre le binding réel d'une capacité hôte `context-read`. L'agent invoque le validateur avant toute écriture ; la validation JavaScript de l'hôte reste en défense en profondeur. Les deux composants sont invocables via `list_wasi_components` et `invoke_wasi_component`. Le validateur ne reçoit aucune capacité ; `context-summary` reçoit uniquement `context-read`.

### Migration progressive des composants historiques

| Composant actuel | Cible WIT envisagée | Capacités candidates |
|---|---|---|
| Agent et orchestration (`browser/agent.js`) | `component-agent` | context-read, model-inference, tool-execution, component-messaging |
| Validation des observations, relations et statuts (`ontology-validator`) | `component-base` (migré) | aucune capacité ; vocabulaire et IDs passés en entrée |
| Lecture du contexte (`context-summary`) | `component-with-context` (première liaison hôte) | context-read ; instantané JSON fourni par l'hôte |\n| Outils de l'espace de travail (`browser/workspace-tools.js`) | monde métier dédié | context-read, context-write, project-storage-read, project-storage-write |
| Adaptateurs d'inférence (`browser/inference.js`) | interface hôte, pas de fournisseur dans le guest | model-inference, audio-transcription |
| Stockage local (`browser/storage.js`) | interface hôte de stockage | project-storage-read, project-storage-write |

Ce tableau distingue explicitement la première logique métier migrée des cibles futures. Les fonctions JavaScript historiques restent exécutées dans l'hôte ; elles ne sont pas présentées comme isolées par WASI. Leur migration se fera par tranches, avec tests de conformité et adaptateurs temporaires à privilèges minimaux.

### Tests

- Tests unitaires du registre, du manifeste, des capacités inconnues/non accordées, des limites de payload et de la corrélation.
- Build CI du vrai binaire composant depuis le WIT.
- Smoke test Playwright dans Chromium : chargement des deux composants transpilés, appel de `lifecycle`, vérification du résultat et validation d'observations, relations et statuts valides/invalides dans le guest WASM.
- Test du chemin métier : une validation refusée par le composant WASI empêche toute écriture du registre.
- Build GitHub Pages vérifie la présence de tous les artefacts WASI avant publication.
