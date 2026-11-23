# Configuration des trois passerelles ICARE

ICARE dispose de trois services indépendants : LLM conversationnel, transcription audio et scoring ICARE multilabel. Chaque service peut être routé en accès direct ou vers une passerelle explicitement sélectionnée.

Chaque passerelle possède un nom, une URL HTTPS et trois capacités indépendantes.

## Affichage progressif

- Au premier paramétrage, Gateway 1 est affichée avec les trois capacités cochées. Gateway 2 et Gateway 3 sont masquées.
- Dès qu’une capacité est décochée sur Gateway 1, Gateway 2 apparaît.
- Dès que deux capacités sont décochées sur Gateway 1, Gateway 3 apparaît également.
- Les capacités et les routes déjà configurées sont conservées ; masquer une fiche ne supprime pas silencieusement ses réglages.

Les URLs de passerelles distantes doivent être HTTPS. Les clés fournisseur ne sont jamais transmises aux passerelles.

## Scoring ICARE : contrat indépendant

Le scoring renvoie cinq scores indépendants pour I, C, A, R et E. Il ne s'agit ni d'une décision exclusive ni d'une normalisation des scores à une somme de 1.

L’interface configure le scoring exactement comme les deux autres services : accès direct vers un endpoint HTTP(S) (HTTP uniquement sur loopback) ou routage vers une Gateway déclarant la capacité `scoring`. Une clé Bearer facultative peut être configurée pour l’accès direct ; elle est chiffrée avec le coffre AES-GCM du navigateur. En mode Gateway, les secrets restent côté serveur et l’authentification passe par la session de l’organisation.

Le navigateur transmet le texte, les cinq descriptions de dimensions et `multi_label: true`. Le service renvoie `{ "scores": { "I": 0.7, "C": 0.4, "A": 0.8, "R": 0.2, "E": 0.5 } }`. Les cinq scores sont validés indépendamment dans l’intervalle [0, 1], sans normalisation à une somme de 1. Aucun modèle, runtime, fournisseur, poids ou mécanisme d’installation de scoring n’est embarqué dans ICARE. La Gateway annonce la capacité réellement disponible via `/v1/icare/config` et relaie le contrat vers une URL administrée indépendamment via `scoring.endpointUrl`.
