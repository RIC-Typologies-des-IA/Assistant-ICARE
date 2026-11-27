# Client navigateur autonome ICARE

Application autonome publiée sous forme de fichiers statiques sur [GitHub Pages](https://ric-typologies-des-ia.github.io/Assistant-ICARE/). Elle s’exécute dans le navigateur, sans serveur ICARE, base SQLite ni bot Discord obligatoires.

Fonctions disponibles : projets et conversations locaux persistés dans IndexedDB, historique de projet, import/export, documents et pièces jointes (lecture PDF, extraction du texte natif et OCR local en français), configuration indépendante des services, scoring ICARE multilabel, transcription, moteur agentique à appels d’outils, composants WASI/WIT, PWA et cache hors ligne. Les capacités et leurs limites évoluent avec les versions du client.

Les données restent dans le navigateur/profil et ne sont pas synchronisées automatiquement entre appareils. Les fournisseurs d’inférence directs doivent autoriser les requêtes depuis l’origine GitHub Pages ; une Gateway compatible peut également être utilisée. Les fonctions de collaboration et de réplication multi-appareils restent hors du chemin critique du client autonome. Les clés API sont chiffrées en AES-256-GCM via Web Crypto ; la clé de chiffrement est non exportable et conservée comme objet CryptoKey dans IndexedDB. Les secrets chiffrés persistent dans le profil du navigateur, sont déchiffrés automatiquement à la réouverture et ne sont jamais inclus dans les projets ou exports. Les anciennes clés en clair sont migrées vers le coffre puis supprimées. Le stockage navigateur n'est pas un coffre-fort contre un appareil compromis.

Le workflow de déploiement publie le contenu de browser/ sur GitHub Pages. Dans Settings → Pages, sélectionner GitHub Actions comme source de publication. URL cible : https://ric-typologies-des-ia.github.io/Assistant-ICARE/

### Mise à jour automatique du client

Le client vérifie la version du Service Worker à chaque ouverture de l’URL, puis au retour sur un onglet précédemment masqué. Chaque artefact GitHub Pages reçoit aussi un identifiant immuable dérivé du commit (`ICARE_BUILD_ID`) : même une publication sans changement du numéro SemVer déclenche donc une nouvelle version du cache et du Service Worker. Lorsqu’une nouvelle publication est détectée, le Service Worker télécharge les ressources de la nouvelle version, s’active sans attendre la fermeture des anciens onglets, puis le client recharge automatiquement l’onglet une seule fois, dès qu’aucun échange n’est en cours et qu’aucun brouillon n’est saisi (pour ne pas interrompre l’utilisateur). Les projets, conversations et paramètres conservés dans IndexedDB/localStorage ne sont pas effacés par cette mise à jour. La mise à jour nécessite une connexion réseau lors de la vérification ; en mode hors ligne, la dernière version mise en cache reste utilisable et la nouvelle version sera récupérée au prochain retour en ligne/ouverture.


## Versionnement

La version courante du client navigateur est **0.11.9** (source de vérité : `package.json`). Le produit ICARE Browser reste en développement pré-1.0 et suit [Semantic Versioning 2.0.0](https://semver.org/). Les numéros de version sont vérifiés par la CI ; les commits et identifiants de build distinguent les publications successives, y compris lorsque le numéro SemVer ne change pas.

Le cache PWA est versionné afin qu’une publication puisse invalider explicitement les ressources précédentes. Le Service Worker récupère les ressources de la nouvelle version sans effacer les projets, conversations, documents ou paramètres conservés dans IndexedDB/localStorage.

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


## Architecture du moteur agentique navigateur

Le runtime `browser/agent.js` implémente un cycle tool-calling compatible avec les API OpenAI Chat Completions. Il expose les outils métier ICARE sans embarquer Node.js ni le SDK Pi. Les données sont écrites dans l'espace de travail du projet via IndexedDB.

Outils disponibles : `list_available_models`, `get_ontology`, `get_exploration_state`, `search_reference_documents`, `list_propositions`, `propose_observation`, `propose_relation`, `update_exploration_status`, `create_reference_document` et `update_reference_document`.

Les opérations agentiques sont couvertes par des tests de comportement : consultation de l'ontologie et de l'état, ajout et relecture d'une proposition issue du dialogue, validation des relations et des statuts, isolation du projet et annulation en cas d'échec de persistance. Les observations et relations sont créées au statut candidat. Les changements de statuts `sufficient` et `not_applicable` exigent une justification. Les documents de référence sont isolés par projet. Le fournisseur de modèle doit prendre en charge les appels d'outils ; un modèle qui ne les prend pas en charge ne peut pas assurer la parité agentique.

Cette livraison restaure un premier socle d'écriture agentique, mais ne prétend pas encore à la parité complète : la réplication CRDT, la migration SQLite et l'intégralité des métadonnées/projections du runtime historique restent des étapes distinctes.


### Transcription Lemonade sur NPU FastFlowLM

Pour partager le NPU avec le scoring ICARE, ne sélectionnez pas les modèles Lemonade `Whisper-*` utilisant la recette `whispercpp`. Dans Configuration → Transcription locale → Fournisseur Lemonade, le bouton de découverte interroge `GET /v1/models?show_all=true` et ne propose que les modèles `recipe=flm` portant le label `transcription`. Le candidat recommandé est `whisper-v3-turbo-FLM` (tag FastFlowLM `whisper-v3:turbo`). Il est présélectionné lorsqu’il est présent dans le catalogue. Le statut distingue les modèles installés de ceux à installer.

La documentation Lemonade décrit la prise en charge simultanée d’un ASR, d’un LLM et d’un modèle d’embeddings FastFlowLM sur le NPU. Cela rend cette architecture adaptée à l’objectif ICARE, mais ne remplace pas un test sur la version exacte de Lemonade, FastFlowLM et le matériel : après installation, exécuter successivement le test du scoring D3, le test de transcription, puis à nouveau le test du scoring D3. La CI vérifie la découverte et le filtrage du catalogue simulé ; elle ne certifie pas la coexistence matérielle avec D3.

## Sécurité entreprise

La posture de sécurité local-first, les invariants machine-readable, le modèle TLA+ et le registre des flux réseau sont décrits dans [security/README.md](security/README.md), [security-policy.json](security-policy.json) et [security/NETWORK_FLOWS.md](security/NETWORK_FLOWS.md). Les tests de contrat sont exécutés avec `npm test`.

Les clés API du mode autonome sont chiffrées et conservées dans le coffre IndexedDB décrit ci-dessus. Le mode entreprise permet de renseigner uniquement l'URL HTTPS d'un gateway distant : après authentification par l'organisation, l'application récupère automatiquement les modèles par défaut autorisés pour l'utilisateur. Les clés fournisseurs restent sur le serveur. Le gateway de référence est documenté dans [enterprise-gateway/README.md](../enterprise-gateway/README.md). Le contrat WIT commun des composants exécutables est décrit dans [component-model/README.md](../component-model/README.md), et la décision d'architecture dans [ADR 0001](../docs/adr/0001-enterprise-gateway-and-component-capabilities.md). Les endpoints directs du mode autonome exigent HTTPS, sauf boucle locale. Le gateway exige une identité fournie par un reverse proxy d'authentification de confiance et n'est pas un proxy ouvert.

### Runtime WASI / WIT dans le navigateur

Le runtime des composants est livré avec la PWA. Les composants sont compilés avec le backend QuickJS puis transpilés pendant les workflows GitHub Actions avec Jco ; les modules JavaScript/Wasm core produits sont publiés avec le client. Les artefacts observés dans la CI pèsent environ 268 Kio et 238 Kio pour les deux composants actuels. Le navigateur n'a pas besoin d'installation locale ni de runtime natif additionnel.

Le premier composant de démonstration respecte le contrat `lifecycle` et peut être invoqué par l'agent. Il ne demande aucune capacité. Le runtime refuse les capacités non accordées, les identifiants absents du registre, les chemins d'entrée hors du répertoire des composants, les payloads de plus de 256 Kio et les réponses dont la corrélation est incohérente.

Cette première tranche n'exécute pas encore les mondes WIT qui importent le contexte, le stockage, l'inférence ou la messagerie. Ces interfaces nécessitent leurs liaisons hôte dédiées et des politiques de permissions avant d'être activées. Les composants historiques restent dans l'hôte JavaScript jusqu'à leur migration.

Le composant `ontology-validator` exécute dans le guest WASM la validation déterministe des observations, relations et statuts avant enregistrement. Le composant `context-summary` reçoit la capacité `context-read` via un import WIT lié par l'hôte ; il ne reçoit qu'un instantané JSON du projet, sans accès direct à IndexedDB, au réseau ou à l'inférence. Les validations côté hôte restent en défense en profondeur.


## Scoring ICARE multilabel

Le scoring ICARE est un service indépendant du LLM conversationnel et de la transcription. Pour chaque message utilisateur, il reçoit le texte et les cinq dimensions I/C/A/R/E et renvoie cinq scores indépendants compris entre 0 et 1. Les scores ne sont pas normalisés pour totaliser 1.

Dans la configuration ICARE, le mode recommandé est **Lemonade local · NPU FastFlowLM**. Le bouton « Lister les moteurs compatibles » interroge `GET /v1/models?show_all=true` sur `http://127.0.0.1:13305` et ne conserve que les modèles `recipe=flm` portant les capacités `classification` et `systemone`. `d3-ultra-FLM` est sélectionné par défaut lorsqu’il figure dans le catalogue. Le scoring utilise `POST /v1/systemone` avec cinq questions `noul` indépendantes (I, C, A, R, E) ; les probabilités ne sont donc pas normalisées entre dimensions. Le texte reste sur la machine. Un modèle marqué « à installer » doit d’abord être téléchargé dans Lemonade. D3 Ultra demande FastFlowLM 1.0.11 ou ultérieur et environ 28 Go de mémoire libre ; si cette capacité n’est pas disponible, sélectionner une variante D3 plus petite. Depuis l’application hébergée sur GitHub Pages, autoriser l’origine du navigateur dans Lemonade avec `lemonade config set allowed_origins="https://ric-typologies-des-ia.github.io"` ; les applications web hébergées sur un autre domaine doivent être explicitement autorisées par `allowed_origins`. Le service HTTP(S) personnalisé et les Gateways déclarant la capacité `scoring` restent disponibles en alternative. Aucun modèle ni runtime n’est embarqué dans le navigateur.


### Laboratoire d’évolution et de personnalisation

Le laboratoire donne accès aux ressources méthodologiques, aux instructions et à la configuration technique qui composent l’outil ICARE. Il permet d’essayer des évolutions avant de les adopter, de personnaliser localement le comportement de l’application et de conserver ces choix dans le profil du navigateur. Les personnalisations restent privées et indépendantes de la version commune : leur partage avec la communauté est facultatif. Lorsqu’un utilisateur souhaite contribuer, il peut exporter une proposition structurée en Markdown, la copier, la préparer par courriel ou ouvrir un formulaire GitHub prérempli. Aucune création d’issue anonyme ni aucun service intermédiaire n’est requis. Les brouillons et jalons sont conservés dans IndexedDB et ne modifient pas les fichiers de production du dépôt.
