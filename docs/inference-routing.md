# Routage indépendant des moteurs d’inférence

ICARE configure séparément les deux opérations qui ne transportent pas les mêmes données :

- **Transcription audio** : transforme l’enregistrement vocal en texte.
- **Traitement du texte** : envoie les messages et le contexte conversationnel au modèle de raisonnement.

Chaque opération choisit son propre transport : `local` (connexion directe à un fournisseur ou à un moteur local) ou `gateway` (passage par la Gateway de l’organisation). « Local / direct » ne garantit pas à lui seul que le serveur est sur l’appareil : un endpoint OpenAI distant reçoit également les données qui lui sont envoyées.

## Combinaisons possibles

| Transcription | Traitement du texte | Conséquence |
| --- | --- | --- |
| Local / direct | Local / direct | Chaque flux est envoyé à son endpoint direct ; celui-ci peut être local ou distant. |
| Local / direct | Gateway | L’audio est envoyé à l’endpoint direct de transcription (local s’il est sur l’appareil) ; seul le texte transcrit est ensuite envoyé à la Gateway de raisonnement. |
| Gateway | Local / direct | L’audio est transmis à la Gateway de transcription ; le texte transcrit est envoyé à l’endpoint direct de traitement du texte. |
| Gateway | Gateway | Les deux opérations utilisent une Gateway commune ou deux Gateways indépendantes. |

## Configuration

- Une route locale expose les champs fournisseur, endpoint, modèle et clé API de la fonction concernée.
- Une route Gateway expose une adresse HTTPS ; les modèles sont obtenus depuis `/v1/icare/config` et l’authentification utilise les cookies de session du navigateur.
- Lorsque les deux routes utilisent Gateway, l’option **Même Gateway** réduit la configuration à une seule adresse. Désactivée, elle permet de définir deux adresses.
- Les clés locales restent chiffrées dans le coffre local et ne sont jamais envoyées à une Gateway.
- Les données sont envoyées au destinataire correspondant au routage de leur opération. En particulier, une transcription locale n’envoie pas l’audio au Gateway texte.

## Persistance et migration

Les réglages sont conservés dans IndexedDB, séparément des projets :

- `inference-routing` : choix local/Gateway pour `text` et `audio`.
- `inference-gateways` : adresses des Gateways et indicateur `sameGateway`.
- `inference-gateway-models` : modèles attribués par chaque Gateway.
- `inference-text` et `inference-transcription` : profils locaux indépendants.

À la première ouverture après mise à jour, les anciennes préférences « autonome » et « entreprise » sont migrées : le mode autonome devient deux routes locales ; le mode entreprise devient deux routes Gateway partageant l’ancienne adresse. L’utilisateur peut ensuite les dissocier.

## Sécurité

Les Gateways distantes doivent utiliser HTTPS. Le client n’envoie aucune clé API fournisseur aux Gateways et utilise les cookies de session uniquement pour les routes Gateway. Une route audio Gateway transmet nécessairement l’enregistrement vocal au serveur correspondant ; une route audio locale évite cette transmission. Le choix du routage texte ne modifie pas le destinataire de l’audio.


## Scoring ICARE multilabel

Le scoring ICARE évalue indépendamment les cinq dimensions I/C/A/R/E pour chaque message, sans normalisation à une somme de 1. Il constitue un troisième service, indépendant du LLM conversationnel et de la transcription.

L’interface configure le scoring comme un troisième fournisseur indépendant :

- **Lemonade local / FastFlowLM (recommandé)** : découverte par `GET /v1/models?show_all=true`, filtrée sur `recipe=flm` et les labels `classification` + `systemone`. Le sélecteur privilégie `d3-ultra-FLM` quand le catalogue le propose. Le scoring appelle `POST /v1/systemone` avec cinq questions `noul` indépendantes, une par dimension. Chaque réponse fournit la probabilité du « oui » ; les cinq valeurs sont comprises entre 0 et 1 et ne sont pas normalisées pour totaliser 1. Le trafic est limité à Lemonade sur loopback ; le contenu ne part pas vers un fournisseur distant.
- **Service personnalisé** : accès direct à un endpoint HTTP(S), HTTP uniquement sur loopback. Une clé Bearer facultative est chiffrée dans le coffre local AES-GCM. Le contrat historique reçoit le texte, les dimensions et `multi_label=true`, puis renvoie `{ "scores": { "I": 0.7, "C": 0.4, "A": 0.8, "R": 0.2, "E": 0.5 } }`.
- **Gateway** : les Gateways déclarant la capacité `scoring` utilisent leur session d’authentification et gardent les secrets amont côté serveur. Une Gateway annonce sa capacité dans `/v1/icare/config` et relaie le contrat vers `scoring.endpointUrl` configuré côté serveur.

Aucun modèle, runtime ou poids n’est embarqué dans le navigateur. Le moteur et ses poids sont administrés par Lemonade/FastFlowLM.
