# ICARE Enterprise Gateway

La Gateway ICARE peut être hébergée sur la machine AMD de l’organisation. Elle exécute le scoring localement ; les appareils mobiles et tablettes lui transmettent leurs messages via une connexion HTTPS contrôlée.

## Contrat

Le gateway expose une façade compatible OpenAI pour le chat et la transcription, ainsi qu’un endpoint ICARE multilabel :
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/audio/transcriptions`
- `POST /v1/icare/scoring` (scoring multilabel ICARE exécuté localement)
- `GET /v1/icare/config` (modèles par défaut visibles pour l'identité authentifiée)

Les identifiants de modèles visibles par le navigateur sont des alias administrés. Chaque alias est associé côté serveur à un fournisseur, un modèle amont, une URL HTTPS fixe et une variable d'environnement contenant la clé API. Le client ne peut jamais choisir une URL amont ni transmettre une clé fournisseur.

## Déploiement

Prérequis : Node.js 22 ou supérieur, un reverse proxy TLS et un fournisseur d'identité d'entreprise.

1. Copier `config.example.json` vers `config.json`.
2. Adapter les origines exactes autorisées et les modèles publiés.
3. Pour le scoring ICARE, aucune clé fournisseur n’est nécessaire. Le modèle est téléchargé une fois dans le cache local au premier démarrage. Les clés éventuellement utilisées par les services LLM ou transcription restent indépendantes.
4. Lancer `npm start` avec `ICARE_GATEWAY_CONFIG=/etc/icare-gateway/config.json`.
5. Conserver le service lié à `127.0.0.1` derrière un reverse proxy HTTPS. Ne pas l'exposer directement sur Internet.
6. Configurer le reverse proxy pour authentifier chaque requête avec le fournisseur d'identité de l'entreprise, supprimer toute valeur entrante du header d'identité, puis injecter lui-même `X-ICARE-Authenticated-User` (et éventuellement les groupes). Le service refuse les requêtes sans cette identité.
7. Faire passer les tests avec `npm test` et vérifier les règles de pare-feu, TLS, CORS et les journaux du reverse proxy.

Exemple de principe Nginx (à adapter à l'IdP et à son module d'authentification) :

```nginx
location / {
  error_page 418 = @icare_cors_preflight;
  if ($request_method = OPTIONS) { return 418; }
  auth_request /oauth2/auth;
  auth_request_set $icare_user $upstream_http_x_auth_request_user;
  proxy_set_header X-ICARE-Authenticated-User $icare_user;
  proxy_set_header X-ICARE-Authenticated-Groups $upstream_http_x_auth_request_groups;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_pass http://127.0.0.1:8787;
}
location @icare_cors_preflight {
  proxy_pass http://127.0.0.1:8787;
}
```

Le proxy doit authentifier réellement la session (OIDC/SAML via un composant éprouvé), écraser les headers d'identité et de groupes reçus du client, injecter les valeurs issues de l'IdP et empêcher tout accès réseau direct au port du gateway. Les requêtes OPTIONS de pré-vol CORS doivent être traitées sans authentification, mais aucune opération métier ne doit l'être. Le gateway écoute sur loopback par défaut précisément pour cette raison. Si le service est exposé directement, un client pourrait falsifier le header d'identité : ce mode de déploiement serait non sécurisé.

## Configuration côté administrateur

`config.example.json` est volontairement sans secret. Les clés sont injectées par variables d'environnement ou par le gestionnaire de secrets de la plateforme. Les modèles non déclarés ou sans capacité adéquate sont refusés. Le modèle de scoring déclare la capacité `scoring` et le runtime local `transformers-js`, avec `modelId` pointant vers `Horizon-Labs/multilingual-zeroshot-base` ou un répertoire local. Aucune URL amont, clé API ou inférence distante n’est admise pour le scoring. Les URL amont doivent être HTTPS et sont définies uniquement par l'administrateur. Un modèle peut aussi déclarer `allowedGroups` dans la configuration ; seuls les groupes transmis par l'IdP via le header de confiance peuvent alors le voir et l'utiliser.

Les limites par défaut incluent quotas par identité, tailles maximales de requête, délai amont et absence de journalisation des prompts. Les requêtes de streaming sont refusées dans cette première version. Le scoring reçoit le texte du message et cinq libellés indépendants ; les cinq scores retournés ne sont pas normalisés en distribution exclusive. Le gateway ne fournit pas de stockage de conversation : les projets restent dans le navigateur.

## Configuration côté utilisateur

Dans Configuration > Moteurs d'inférence, saisir l'URL HTTPS du gateway. Les catalogues et valeurs par défaut des modèles LLM, transcription et scoring sont fournis par la Gateway. Les champs de clés et les endpoints directs sont ignorés dans ce mode. Le navigateur n'obtient jamais les clés fournisseurs. Le endpoint de configuration fournit automatiquement les alias de modèles par défaut autorisés pour l'utilisateur ; en mode entreprise, aucun choix de fournisseur ni de modèle n'est nécessaire côté utilisateur.

L'authentification est déléguée à l'IdP d'entreprise placé devant le gateway. Le navigateur envoie les cookies de session avec les requêtes cross-origin. Pour les navigateurs qui bloquent les cookies tiers, déployer l'application et le gateway sous le même site d'entreprise (domaine personnalisé GitHub Pages, par exemple `icare.example.org` et `gateway.icare.example.org`) ou ajouter un flux OIDC Authorization Code + PKCE avec échange de jeton côté gateway. Ne pas désactiver l'authentification pour contourner ce problème.

## Garanties et limites

- Les clés fournisseur ne sont jamais exposées au client.
- Le client ne contrôle ni les destinations amont ni les modèles amont.
- CORS est limité à une liste exacte d'origines HTTPS.
- Les routes d'inférence exigent une identité fournie par un reverse proxy de confiance.
- Les quotas sont en mémoire dans cette première version ; une installation multi-instance doit utiliser un limiteur partagé.
- Le gateway ne remplace ni l'IdP, ni le pare-feu, ni la gestion des secrets, ni les contrôles contractuels de conservation des données chez le fournisseur.
- Cette première livraison ne prétend pas fournir un SSO universel : la configuration de l'IdP/reverse proxy reste spécifique à l'organisation.


## Relais du scoring ICARE

La Gateway peut relayer le service de scoring multilabel ICARE vers un endpoint administré indépendamment. Renseigner `scoring.endpointUrl` dans le fichier de configuration local. L’URL doit utiliser HTTPS, sauf si le service est explicitement hébergé sur loopback HTTP. La Gateway valide le contrat ICARE et relaie la requête/réponse ; elle n’embarque aucun moteur, poids, runtime ou dépendance de scoring.
