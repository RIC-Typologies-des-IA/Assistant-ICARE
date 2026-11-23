# Client navigateur autonome ICARE

Première tranche autonome en cours de réalisation, destinée à être publiée en fichiers statiques : pas de serveur Node.js, SQLite ou bot Discord.

Fonctions : projets locaux, conversations persistées dans IndexedDB, export/import JSON, routage indépendant du LLM, de la transcription et du scoring ICARE multilabel, trois passerelles configurables, PWA et cache statique.

Limites : le fournisseur doit autoriser CORS depuis GitHub Pages ; les données restent dans ce navigateur/profil et ne sont pas synchronisées ; les propositions structurées, relations et CRDT seront réintégrés progressivement. Les clés API sont chiffrées en AES-256-GCM via Web Crypto ; la clé de chiffrement est non exportable et conservée comme objet CryptoKey dans IndexedDB. Les secrets chiffrés persistent dans le profil du navigateur, sont déchiffrés automatiquement à la réouverture et ne sont jamais inclus dans les projets ou exports. Les anciennes clés en clair sont migrées vers le coffre puis supprimées. Le stockage navigateur n'est pas un coffre-fort contre un appareil compromis.

Le workflow de déploiement publie le contenu de browser/ sur GitHub Pages. Dans Settings → Pages, sélectionner GitHub Actions comme source de publication. URL cible : https://ric-typologies-des-ia.github.io/Assistant-ICARE/

### Mise à jour automatique du client

Le client vérifie la version du Service Worker à chaque ouverture de l’URL, puis au retour sur un onglet précédemment masqué. Chaque artefact GitHub Pages reçoit aussi un identifiant immuable dérivé du commit (`ICARE_BUILD_ID`) : même une publication sans changement du numéro SemVer déclenche donc une nouvelle version du cache et du Service Worker. Lorsqu’une nouvelle publication est détectée, le Service Worker télécharge les ressources de la nouvelle version, s’active sans attendre la fermeture des anciens onglets, puis le client recharge automatiquement l’onglet une seule fois, dès qu’aucun échange n’est en cours et qu’aucun brouillon n’est saisi (pour ne pas interrompre l’utilisateur). Les projets, conversations et paramètres conservés dans IndexedDB/localStorage ne sont pas effacés par cette mise à jour. La mise à jour nécessite une connexion réseau lors de la vérification ; en mode hors ligne, la dernière version mise en cache reste utilisable et la nouvelle version sera récupérée au prochain retour en ligne/ouverture.


## Versionnement

Le client navigateur suit [Semantic Versioning 2.0.0](https://semver.org/) avec une séquence propre au produit **ICARE Browser**. La version initiale déclarée était **0.6.0**. La version courante est **0.9.0**, qui ajoute le mode gateway d'entreprise distant, tout en conservant le moteur agentique navigateur, les capacités d'écriture contrôlée et la relecture temporelle du dialogue. Le produit reste en développement initial (pré-1.0), sans promesse de stabilité de son interface ou de ses données. Les trois composantes sont toujours conservées (`MAJOR.MINOR.PATCH`). Avant 1.0.0, toute évolution incompatible du contrat public du navigateur incrémente au minimum MINOR ; PATCH est réservé aux corrections compatibles. Les changements éditoriaux ou internes sans changement de contrat ne nécessitent pas d’incrément. Les commits et tags identifient les révisions/publications ; le numéro SemVer ne remplace pas ces identités. Les anciens suffixes de cache `v5` et `v6` étaient des identifiants techniques internes, pas des versions produit, et ne sont pas convertis rétroactivement.

La version produit est définie dans `package.json`, répercutée dans `version.js` pour l’application et le service worker, et vérifiée par la CI. Le cache PWA utilise le nom `icare-browser-<version SemVer>` afin qu’une nouvelle version invalide explicitement les ressources précédentes.


## Contexte transmis au modèle local

À chaque requête de dialogue, le client navigateur construit un message `system` à partir de :

1. `system-prompt.md` : rôle, posture, règles de dialogue et limites de capacité ;
2. `guide-icare.md` : référentiel méthodologique ;
3. `icare.json` : ontologie structurée complète ;
4. le nom et l'intention du projet ;
5. l'état courant des cinq dimensions et les 40 dernières propositions au plus (JSON).

Il ajoute ensuite les 16 derniers échanges au plus, puis le message courant de l'utilisateur. Le fournisseur configuré reçoit ces messages via l'API Chat Completions compatible OpenAI.

Le client navigateur fournit un moteur agentique à appels d'outils. Les opérations sont exécutées localement dans le projet courant : consultation de l'ontologie et des documents, recherche documentaire, propositions et relations candidates, mise à jour justifiée des statuts, création et modification de documents de référence. La validation/rejet des propositions reste humaine. Le moteur impose une limite de huit étapes d'outils par tour et ne dispose d'aucun accès arbitraire au système de fichiers ou au navigateur.

Le runtime Pi est distinct : il expose des outils ICARE (état d'exploration, ontologie, recherche documentaire, propositions et relations). Son corpus documentaire est initialisé pour chaque projet local et consultable par `search_reference_documents`.


## Moteur agentique navigateur — 0.8.2

Le runtime `browser/agent.js` implémente un cycle tool-calling compatible avec les API OpenAI Chat Completions. Il expose les outils métier ICARE sans embarquer Node.js ni le SDK Pi. Les données sont écrites dans l'espace de travail du projet via IndexedDB.

Outils disponibles : `list_available_models`, `get_ontology`, `get_exploration_state`, `search_reference_documents`, `list_propositions`, `propose_observation`, `propose_relation`, `update_exploration_status`, `create_reference_document` et `update_reference_document`.

Les opérations agentiques sont couvertes par des tests de comportement : consultation de l'ontologie et de l'état, ajout et relecture d'une proposition issue du dialogue, validation des relations et des statuts, isolation du projet et annulation en cas d'échec de persistance. Les observations et relations sont créées au statut candidat. Les changements de statuts `sufficient` et `not_applicable` exigent une justification. Les documents de référence sont isolés par projet. Le fournisseur de modèle doit prendre en charge les appels d'outils ; un modèle qui ne les prend pas en charge ne peut pas assurer la parité agentique.

Cette livraison restaure un premier socle d'écriture agentique, mais ne prétend pas encore à la parité complète : la réplication CRDT, la migration SQLite et l'intégralité des métadonnées/projections du runtime historique restent des étapes distinctes.


## Sécurité entreprise

La posture de sécurité local-first, les invariants machine-readable, le modèle TLA+ et le registre des flux réseau sont décrits dans [security/README.md](security/README.md), [security-policy.json](security-policy.json) et [security/NETWORK_FLOWS.md](security/NETWORK_FLOWS.md). Les tests de contrat sont exécutés avec `npm test`.

Les clés API du mode autonome sont chiffrées et conservées dans le coffre IndexedDB décrit ci-dessus. Le mode entreprise permet de renseigner uniquement l'URL HTTPS d'un gateway distant : après authentification par l'organisation, l'application récupère automatiquement les modèles par défaut autorisés pour l'utilisateur. Les clés fournisseurs restent sur le serveur. Le gateway de référence est documenté dans [enterprise-gateway/README.md](../enterprise-gateway/README.md). Le contrat WIT commun des composants exécutables est décrit dans [component-model/README.md](../component-model/README.md), et la décision d'architecture dans [ADR 0001](../docs/adr/0001-enterprise-gateway-and-component-capabilities.md). Les endpoints directs du mode autonome exigent HTTPS, sauf boucle locale. Le gateway exige une identité fournie par un reverse proxy d'authentification de confiance et n'est pas un proxy ouvert.

### Runtime WASI / WIT dans le navigateur

Le runtime des composants est livré avec la PWA. Les composants sont compilés avec le backend QuickJS puis transpilés pendant les workflows GitHub Actions avec Jco ; les modules JavaScript/Wasm core produits sont publiés avec le client. Les artefacts observés dans la CI pèsent environ 268 Kio et 238 Kio pour les deux composants actuels. Le navigateur n'a pas besoin d'installation locale ni de runtime natif additionnel.

Le premier composant de démonstration respecte le contrat `lifecycle` et peut être invoqué par l'agent. Il ne demande aucune capacité. Le runtime refuse les capacités non accordées, les identifiants absents du registre, les chemins d'entrée hors du répertoire des composants, les payloads de plus de 256 Kio et les réponses dont la corrélation est incohérente.

Cette première tranche n'exécute pas encore les mondes WIT qui importent le contexte, le stockage, l'inférence ou la messagerie. Ces interfaces nécessitent leurs liaisons hôte dédiées et des politiques de permissions avant d'être activées. Les composants historiques restent dans l'hôte JavaScript jusqu'à leur migration.

Le composant `ontology-validator` exécute dans le guest WASM la validation déterministe des observations, relations et statuts avant enregistrement. Le composant `context-summary` reçoit la capacité `context-read` via un import WIT lié par l'hôte ; il ne reçoit qu'un instantané JSON du projet, sans accès direct à IndexedDB, au réseau ou à l'inférence. Les validations côté hôte restent en défense en profondeur.


## Scoring ICARE multilabel

Le scoring utilise `Horizon-Labs/multilingual-zeroshot-base`. Chaque message utilisateur reçoit cinq scores indépendants I/C/A/R/E ; ils ne sont pas normalisés à une somme de 1. Le résultat est enregistré avec le message et réaffiché lors de la relecture de l'historique.

- Accès direct : endpoint local sur `http://127.0.0.1:8787/v1/icare/scoring`.
- Via Gateway : `POST /v1/icare/scoring` sur une Gateway contrôlée, qui exécute elle-même le modèle localement.
- Aucune clé Hugging Face, aucune API d'inférence distante et aucun envoi du texte des conversations à un fournisseur externe.
- Les textes sont en français ; les labels et descriptions de classification sont en anglais, conformément à la fiche du modèle.

Les trois fiches Gateway affichent les capacités LLM, transcription et scoring. La règle de disponibilité limite les fiches superflues sans effacer silencieusement les routes déjà sélectionnées.


## Exécution locale du scoring

Le scoring ICARE utilise `Horizon-Labs/multilingual-zeroshot-base` via Transformers.js et ONNX Runtime CPU. À la première utilisation du scoring, les fichiers du modèle sont téléchargés depuis le dépôt public du modèle puis conservés dans `.cache/transformers` (ou `ICARE_MODEL_CACHE`). **Ce téléchargement concerne uniquement les poids du modèle : les textes et les requêtes d’inférence ne sont jamais envoyés à Hugging Face.**

Pour une installation préparée hors ligne, placer les fichiers du modèle dans un répertoire local, définir `modelId` vers ce répertoire et lancer avec `ICARE_MODELS_OFFLINE=1`. Le endpoint direct du navigateur est limité à `localhost`, `127.0.0.1` ou `::1`. Une Gateway utilisée par les mobiles doit exécuter le même modèle localement sur la machine qui l’héberge ; l’accès depuis le réseau doit être protégé par HTTPS et authentification.
