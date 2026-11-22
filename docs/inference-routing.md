# Routage indépendant des moteurs d’inférence

ICARE configure séparément les deux opérations qui ne transportent pas les mêmes données :

- **Transcription audio** : transforme l’enregistrement vocal en texte.
- **Traitement du texte** : envoie les messages et le contexte conversationnel au modèle de raisonnement.

Chaque opération choisit son propre transport : `local` (connexion directe à un fournisseur ou à un moteur local) ou `gateway` (passage par la Gateway de l’organisation). « Local / direct » ne garantit pas à lui seul que le serveur est sur l’appareil : un endpoint OpenAI distant reçoit également les données qui lui sont envoyées.

## Combinaisons possibles

| Transcription | Traitement du texte | Conséquence |
| --- | --- | --- |
| Local | Local | L’audio et le texte sont traités par des moteurs configurés sur l’appareil ou sur le réseau local. |
| Local | Gateway | La voix est transcrite localement ; seul le texte transcrit est ensuite envoyé à la Gateway de raisonnement. |
| Gateway | Local | L’audio est transmis à la Gateway de transcription ; le texte transcrit est traité par le moteur local. |
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
