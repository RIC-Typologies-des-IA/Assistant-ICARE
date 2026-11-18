# Runtime ICARE avec Pi, Lemonade, QEMU et nono

Cette application est le runtime expérimental ICARE. [Pi](https://github.com/earendil-works/pi) est intégré au backend Node.js via son [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) et son [système d'extensions](https://docs.pi.dev/latest/extensions). Le backend tourne dans une VM [NixOS](https://nixos.org/manual/nixos/stable/) / [QEMU](https://www.qemu.org/docs/master/system/) et son processus est sandboxé par [nono](https://github.com/nolabs-ai/nono). [Lemonade Server](https://github.com/lemonade-sdk/lemonade) reste sur l'hôte Linux pour conserver l'accès au NPU.

## Documentation des composants

- [Pi — SDK et cycle de vie des sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) ; [extensions et outils personnalisés](https://docs.pi.dev/latest/extensions).
- [Lemonade Server](https://github.com/lemonade-sdk/lemonade) — installation, catalogue de modèles et API locale.
- [nono](https://github.com/nolabs-ai/nono) — confinement et filtrage des accès.
- [QEMU](https://www.qemu.org/docs/master/system/) et [manuel NixOS](https://nixos.org/manual/nixos/stable/) — VM et système invité.
- [Références conceptuelles et bibliographie complète](../REFERENCES.md).

## Lancement

Depuis le dépôt, après installation de Nix :

    nix --extra-experimental-features "nix-command flakes" run .#default

Le README racine donne une commande unique qui installe Nix si nécessaire et lance la VM depuis GitHub. Le lanceur ouvre le navigateur hôte lorsque possible. En mode sans interface graphique, l'URL locale de secours est `http://127.0.0.1:8765` ; elle n'est pas exposée sur le réseau local.

Le disque QCOW2 de la VM est créé dans le répertoire courant. Il contient les données persistantes ; ne le supprime pas si tu souhaites conserver les conversations et la mémoire.

## Réseau et confinement

- Lemonade reste sur l'hôte, par exemple sur `127.0.0.1:13305`. Le proxy nono de l'hôte y accède directement ; Lemonade n'a donc pas besoin d'écouter sur `0.0.0.0`.
- QEMU transfère le port de l'interface web de l'hôte vers la VM, en liant le port hôte à `127.0.0.1`.
- Le service ICARE est lancé par `nono run --block-net` dans la VM. Deux ports sont explicitement autorisés : le port du proxy QEMU vers l'hôte et le port d'écoute web. Le réseau QEMU est lui-même restreint : la VM ne peut pas établir d'autre connexion.
- Le proxy nono de l'hôte écoute sur `127.0.0.1:43128` et autorise seulement `http://127.0.0.1:13305/v1/**`, `https://discord.com/api/**` et `gateway.discord.gg`. QEMU transfère le port proxy vers l'invité et expose le port web 8765 uniquement sur le loopback hôte.
- Aucun outil shell, navigateur, accès arbitraire aux fichiers, MCP ou recherche Web n'est fourni au modèle.

Le réseau invité est restreint par QEMU (`restrictNetwork = true`) : il ne dispose pas d'un accès Internet général. Le code et les dépendances sont préparés sur l'hôte avant le démarrage de la VM, puis montés en lecture seule dans l'invité. Le seul flux sortant prévu passe par le proxy nono de l'hôte. Le provisionnement npm devra être rendu reproductible avec un lockfile avant une diffusion de production.

## Dialogue Pi ↔ Lemonade : catalogue dynamique

Au démarrage et à la demande, le backend lit `GET /v1/models?show_all=true` sur l'[API OpenAI-compatible de Lemonade](https://github.com/lemonade-sdk/lemonade). Il expose les modèles de conversation à Pi et au tableau de bord, avec leurs labels, leur contexte et leur disponibilité.

- Le tableau de bord propose un sélecteur de modèle et un bouton d'actualisation du catalogue. Les modèles non téléchargés restent visibles mais ne peuvent pas être sélectionnés avant leur installation dans Lemonade.
- Pi dispose de l'outil `list_available_models` pour consulter les modèles connus de Lemonade et peut recommander un modèle selon le besoin exprimé.
- L'utilisateur garde la décision de changement ; le backend appelle `session.setModel()` sur les sessions Pi existantes.
- Les modèles portant le label `tool-calling` sont recommandés. Sans cette capacité, les outils ICARE peuvent ne pas fonctionner correctement.
- `ICARE_MODEL` reste disponible comme préférence initiale facultative, mais aucun modèle n'est imposé dans le code.

Le choix dynamique s'appuie sur le catalogue Lemonade et le changement de modèle du SDK Pi. Il ne délègue pas à l'agent un pouvoir de modifier seul sa configuration.

## Outils ICARE fournis à Pi

- `get_ontology` : consulter l'ontologie structurée complète, source de vérité des dimensions et des vocabulaires de classification.
- `get_exploration_state` : consulter l'état des cinq dimensions dans l'ordre canonique I, C, A, R, E.
- `search_reference_documents` : rechercher dans le corpus documentaire local.
- `list_propositions` : consulter les propositions et leur statut.
- `propose_observation` : enregistrer une observation comme candidate, avec ses qualifications temporelles, évaluatives, modales, épistémiques et sa provenance lorsqu'elles sont connues.
- `propose_relation` : proposer une relation historisée entre deux observations existantes ; elle reste candidate à validation humaine.

À chaque tour apportant une information nouvelle et substantielle, le prompt système demande explicitement à Pi de qualifier les éléments et d'appeler `propose_observation` sans attendre une demande d'enregistrement. Le serveur vérifie ensuite dans SQLite si l'appel a réellement créé une proposition ; si le modèle a seulement annoncé un enregistrement, une passe interne de rattrapage lui demande d'utiliser l'outil. L'interface n'affiche une confirmation d'enregistrement qu'après vérification effective en base et signale explicitement toute annonce non confirmée. Les propositions alimentent le panneau latéral et les compteurs de chaque dimension ; elles restent candidates jusqu'à validation humaine. Le label `tool-calling` du catalogue est un indicateur de capacité, pas une preuve d'exécution. Seul un test réel de bout en bout — réponse du modèle, émission d'un appel d'outil, exécution côté Pi et écriture SQLite — confirme que le modèle et le serveur fonctionnent ensemble.
- `list_available_models` : consulter le catalogue des modèles de conversation Lemonade.

Le contrôleur conserve le dernier mot : les propositions attendent une validation humaine ; les statuts d'exploration sont modifiés explicitement dans l'interface. Les statuts « suffisamment explorée » et « non applicable » exigent une justification.

## Données

Les données sont conservées dans le disque virtuel QCOW2, sous `/var/lib/icare` dans la VM. SQLite conserve les propositions, les statuts d'exploration, les relations et les documents. Les sessions Pi sont conservées dans le répertoire dédié du runtime.

## Initialisation des outils Pi

Les outils ICARE sont enregistrés par une extension chargée par `DefaultResourceLoader`. Pendant cette phase de chargement, le SDK n'a pas encore lié les méthodes d'action de l'API d'extension : il ne faut donc pas appeler `pi.setActiveTools()` depuis la fonction de fabrique. Les outils ICARE sont déclarés avec l'exposition `direct`. Comme la session est créée avec `noTools: "builtin"`, sa sélection initiale est vide : le backend active donc explicitement les outils ICARE après création avec `session.setActiveToolsByName()`. Il vérifie ensuite avec `session.getActiveToolNames()` que les sept outils attendus sont réellement disponibles ; en cas d'absence, il expose l'erreur précise dans `/api/status` et refuse de prétendre que l'initialisation a réussi.

Cette séquence suit le [cycle de vie documenté des extensions Pi](https://docs.pi.dev/latest/extensions) et le [guide SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).

## Tests

    cd pi-runtime
    npm install --ignore-scripts
    npm test
    node --check src/server.js

Le workflow GitHub Actions vérifie les tests Node.js et construit la VM NixOS. Ces vérifications ne remplacent pas un test d'intégration sur une machine Linux réelle avec QEMU, nono, Lemonade et un modèle compatible tool-calling.

## Limites

- L'adaptateur Discord n'est pas encore implémenté ; les destinations Discord sont préparées dans l'allowlist réseau, sans flux applicatif Discord actif.
- Le dialogue Pi/Lemonade et le changement de modèle sont intégrés au catalogue exposé par Lemonade ; l'inférence réelle doit encore être validée avec les modèles présents sur la machine cible.
- Les sessions sont maintenues en mémoire pendant l'exécution du serveur ; la restauration automatique du fil de dialogue après redémarrage reste à finaliser.
- La mémoire documentaire initiale est textuelle et la recherche lexicale ; embeddings et analyse visuelle restent à implémenter.
- Le bootstrap npm doit être remplacé par une installation reproductible verrouillée avant un usage de production.

Cette version est une base expérimentale à éprouver, pas encore une version de production. Les tests automatisés ne remplacent pas le test d'intégration réel avec la version de Pi, le serveur Lemonade et le modèle sélectionné.

## Ontologies complémentaires

ICARE reste la couche descriptive du système et conserve exactement cinq dimensions dans l'ordre I, C, A, R, E. Les autres couches ne sont pas des dimensions supplémentaires : elles qualifient les propositions et les relations entre elles.

Le référentiel `reference/icare.json` formalise désormais six couches :
- **ICARE descriptive** : intention, contexte, action, régulation/organisation, évolution.
- **États et temporalité** : temps d'énonciation, période de validité, période d'événement, horizon cible et temps de réalisation. Ces repères ne sont pas ramenés à une simple étiquette passé/présent/futur.
- **Évaluation et modalités** : souhaité, non souhaité, redouté, préférable ou défavorable, distingués de possible, impossible, nécessaire, permis ou interdit.
- **Épistémique et provenance** : affirmation, information rapportée, inférence, hypothèse ou prévision ; auteur, agent/source, interaction et justification lorsqu'ils sont connus.
- **Statut pratique** : envisagé, proposé, décidé, engagé, en cours, réalisé ou abandonné.
- **Relations et historique** : confirmation, précision, complément, nuance, contradiction, révision, succession temporelle, état antérieur/actuel/cible, contribution, empêchement ou condition.

Les propositions peuvent conserver leurs périodes et qualifications sans écraser les versions antérieures. La confiance enregistrée correspond à la confiance du système dans l'extraction, et non à la certitude de la personne ou de la source. Les champs inconnus restent inconnus : le modèle ne doit pas inventer de dates, d'auteurs ou de preuves.

Les relations sont proposées par l'outil `propose_relation` et restent candidates à validation humaine, comme les observations. Elles sont exposées dans `/api/state`, affichées dans le panneau « Relations à valider » et peuvent être validées ou rejetées séparément via `/api/relations/:id`. Les migrations SQLite ajoutent les champs complémentaires aux bases existantes sans supprimer les données précédentes.

### Références conceptuelles

Le modèle réutilise sélectivement des distinctions issues de [DOLCE](https://www.loa.istc.cnr.it/index.php/dolce/), [BFO](https://github.com/BFO-ontology/BFO-2020), [UFO](https://ontouml.org/ufo/), de l'[algèbre des intervalles de James Allen](https://cse.unl.edu/~choueiry/Documents/Allen-CACM1983.pdf), de [PROV-O](https://www.w3.org/TR/prov-o/) et de la [théorie des intentions et plans de Michael Bratman](https://press.uchicago.edu/ucp/books/book/distributed/I/bo3629095.html). Ces références sont des inspirations ; le runtime n'embarque pas intégralement ces ontologies et ne dépend pas d'une infrastructure RDF/OWL. Le format de référence reste un JSON léger et inspectable. Chaque entrée du fichier [`reference/icare.json`](reference/icare.json) renvoie également à sa source.
