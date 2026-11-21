# Modèle formel de sécurité ICARE Browser

Ce dossier décrit le contrat de sécurité de l'application navigateur. Il sépare les invariants de conception, les contrôles réellement présents et les preuves encore nécessaires.

## Artefacts

- `../security-policy.json` : contrat machine-readable consommé par les tests.
- `ICARE_SECURITY.tla` : modèle TLA+ abstrait des frontières de données et de l'inférence.
- `../test/security-posture.test.js` : vérifications exécutables du contrat et de quelques propriétés runtime.

## Variables et frontières

Le modèle distingue :
- `projectStore` : données de projets conservées localement ;
- `sessionSecrets` : clés saisies pour la session courante ;
- `persistentSecrets` : secrets qui ne doivent jamais être persistés ;
- `outbound` : requêtes quittant le navigateur ;
- `userRequestedInference` : consentement explicite à l'inférence ;
- `serviceWorkerEnabled` : capacité PWA optionnelle, non nécessaire à la sûreté des données.

## Invariants de sûreté

1. **NoPersistentCredentials** : aucun secret fournisseur dans le stockage persistant.
2. **InferenceRequiresConsent** : les flux métier vers l'inférence ne sont déclenchés qu'après une action explicite.
3. **OnlyApprovedInferencePayloadsEgress** : seuls les contenus explicitement approuvés pour une requête d’inférence peuvent sortir du navigateur.
4. **InferenceDestinationApproved** : chaque requête d’inférence vise une origine autorisée.
5. **TypeOK** : les états restent dans leurs domaines.

Le modèle est volontairement abstrait : il formalise les propriétés visées, mais ne prouve pas à lui seul le code JavaScript, le navigateur, le fournisseur ou l'infrastructure. Les tests runtime, captures réseau et contrôles de déploiement restent indispensables.

## Hypothèses

- Le navigateur et le système d'exploitation ne sont pas compromis.
- Le code ICARE livré à l'origine de confiance n'est pas altéré.
- Les endpoints d'inférence autorisés sont définis par la configuration de déploiement.
- Le contenu envoyé en inférence est considéré comme une divulgation volontaire à ce fournisseur.

## Vérification

Le modèle peut être vérifié avec le TLC model checker de TLA+. Les tests JavaScript associés sont exécutés par `npm test` depuis `browser/`.
