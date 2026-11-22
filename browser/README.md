# Client navigateur autonome ICARE

Première tranche autonome en cours de réalisation, destinée à être publiée en fichiers statiques : pas de serveur Node.js, SQLite ou bot Discord.

Fonctions : projets locaux, conversations persistées dans IndexedDB, export/import JSON, configuration d'une API compatible OpenAI Chat Completions, PWA et cache statique.

Limites : le fournisseur doit autoriser CORS depuis GitHub Pages ; les données restent dans ce navigateur/profil et ne sont pas synchronisées ; les propositions structurées, relations et CRDT seront réintégrés progressivement. Les clés API sont chiffrées en AES-256-GCM via Web Crypto ; la clé de chiffrement est non exportable et conservée comme objet CryptoKey dans IndexedDB. Les secrets chiffrés persistent dans le profil du navigateur, sont déchiffrés automatiquement à la réouverture et ne sont jamais inclus dans les projets ou exports. Les anciennes clés en clair sont migrées vers le coffre puis supprimées. Le stockage navigateur n'est pas un coffre-fort contre un appareil compromis.

Le workflow de déploiement publie le contenu de browser/ sur GitHub Pages. Dans Settings → Pages, sélectionner GitHub Actions comme source de publication. URL cible : https://ric-typologies-des-ia.github.io/Assistant-ICARE/


## Versionnement

Le client navigateur suit [Semantic Versioning 2.0.0](https://semver.org/) avec une séquence propre au produit **ICARE Browser**. La version initiale déclarée était **0.6.0**. La version courante est **0.8.8**, qui ajoute le moteur agentique navigateur et les capacités d'écriture contrôlée dans les projets ICARE, en complément de la relecture temporelle du dialogue. Le produit reste en développement initial (pré-1.0), sans promesse de stabilité de son interface ou de ses données. Les trois composantes sont toujours conservées (`MAJOR.MINOR.PATCH`). Avant 1.0.0, toute évolution incompatible du contrat public du navigateur incrémente au minimum MINOR ; PATCH est réservé aux corrections compatibles. Les changements éditoriaux ou internes sans changement de contrat ne nécessitent pas d’incrément. Les commits et tags identifient les révisions/publications ; le numéro SemVer ne remplace pas ces identités. Les anciens suffixes de cache `v5` et `v6` étaient des identifiants techniques internes, pas des versions produit, et ne sont pas convertis rétroactivement.

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

Les clés d'inférence sont limitées à la session de l'onglet et ne sont pas persistées dans IndexedDB. Les endpoints d'inférence distants doivent utiliser HTTPS ; HTTP reste autorisé uniquement pour les services de boucle locale (localhost, 127.0.0.1, ::1). Cette validation protège le transport, mais ne remplace pas une allowlist d'origines définie au niveau du déploiement ou du réseau.
