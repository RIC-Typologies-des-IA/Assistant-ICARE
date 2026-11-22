# ADR 0001 — Gateway d'entreprise distant et capacités des composants

- **Statut :** accepté pour la tranche de sécurité de la PR #85
- **Date :** 2026-11-22

## Contexte

ICARE doit rester utilisable en ouvrant simplement son URL GitHub Pages : aucun daemon, runtime ou paquet local ne peut être requis. Les organisations doivent pouvoir centraliser les clés fournisseurs, les politiques d'accès et les quotas, sans exposer ces secrets au navigateur.

L'application conserve par ailleurs un mode autonome : l'utilisateur configure directement ses fournisseurs et les clés sont protégées au repos dans le coffre Web Crypto du navigateur.

## Décision

### Mode autonome

- Le navigateur appelle directement le fournisseur configuré.
- Les clés sont stockées chiffrées dans IndexedDB avec AES-256-GCM et une CryptoKey non exportable.
- Cette protection au repos ne constitue pas une frontière contre une XSS ou un code de même origine compromis.

### Mode entreprise

- L'utilisateur renseigne uniquement l'URL HTTPS du gateway distant.
- Le gateway publie les modèles par défaut autorisés pour son identité ; aucun endpoint fournisseur, modèle amont ou secret n'est demandé à l'utilisateur.
- Les clés API fournisseurs sont détenues par l'administrateur et injectées au service depuis un gestionnaire de secrets ou l'environnement.
- Le gateway mappe des alias de modèles vers des destinations HTTPS fixes définies par l'administrateur.
- L'identité et les groupes proviennent d'un reverse proxy d'authentification de confiance. Celui-ci doit écraser les headers d'identité fournis par le client ; le service écoute sur loopback derrière ce proxy.
- CORS n'autorise que des origines HTTPS exactes. Les payloads sortants sont filtrés, les modèles et capacités sont allowlistés, les groupes peuvent restreindre les modèles, et les quotas/tailles/délais sont bornés.
- Le gateway ne journalise pas les prompts et ne stocke pas les projets ou conversations.

Le mode cookie cross-origin peut être limité par les politiques de blocage des cookies tiers. Les déploiements doivent préférer un domaine personnalisé d'entreprise commun à l'application et au gateway, ou prévoir une évolution vers OIDC Authorization Code + PKCE avec échange de jeton côté gateway. Il ne faut jamais désactiver l'authentification pour contourner cette limite.

### Modèle de composants cible

Les composants exécutables ICARE doivent converger vers un contrat commun décrit en WIT (WebAssembly Interface Types) et exécuté dans un runtime contrôlé. Ils déclarent leurs besoins en capacités ; ils ne reçoivent aucun accès implicite au réseau, au stockage, aux secrets ou aux outils.

Le runtime/hôte fournit les interfaces métier (contexte, messagerie, stockage, inférence, outils) et arbitre chaque opération. En mode entreprise, la capacité d'inférence est satisfaite par le gateway distant ; en mode autonome, elle est satisfaite par l'adaptateur fournisseur local au navigateur.

WASI et le Component Model sont le socle d'isolation et de portabilité visé pour les composants exécutables. Ils ne remplacent ni le modèle de permissions ICARE, ni l'authentification, ni le gateway. Le runtime WebAssembly doit contrôler les imports et ne pas exposer de réseau ou de fichiers ambiants. Les composants historiques non-WASM doivent passer par des adaptateurs à capacités restreintes pendant la migration.

Cette PR met en place le gateway d'entreprise et son contrat opérationnel ; elle ne prétend pas encore avoir migré tous les composants ICARE vers WASI/WIT.

## Conséquences

- Le déploiement web reste sans installation.
- L'entreprise maîtrise les secrets fournisseurs et les modèles proposés.
- Le gateway devient une frontière réseau et de gouvernance, sous réserve d'un reverse proxy correctement configuré.
- Le service de référence est dans `enterprise-gateway/`.
- Le contrat formel du gateway est décrit dans `browser/security/ICARE_ENTERPRISE_GATEWAY.tla`.
- Le runtime WASI/WIT commun est une étape d'architecture ultérieure ; aucun composant non contrôlé ne doit être présenté comme isolé par WASI avant son intégration effective au runtime.

## Alternatives écartées

- **Gateway local obligatoire :** rejeté, car incompatible avec l'ouverture de l'URL comme seule étape d'installation.
- **Proxy distant sans identité :** rejeté, car il transformerait le gateway en service ouvert et exposerait le budget de l'organisation.
- **URL fournisseur arbitraire fournie par le navigateur :** rejetée, car elle permettrait de détourner le gateway vers des destinations non administrées.
- **Clés API renvoyées au navigateur :** rejetées, car elles annuleraient le bénéfice du mode entreprise.
