# Registre des flux réseau ICARE Browser

Ce registre est une base de contrôle. Il doit être mis à jour à chaque ajout de fonctionnalité qui utilise le réseau. Les destinations réelles sont définies par la configuration de déploiement et doivent être confirmées par capture navigateur.

| Flux | Déclencheur | Données | Statut / contrôle |
|---|---|---|---|
| Fichiers statiques de l'application | Chargement / mise à jour | Code et ressources publiques, pas de projets | Origine de déploiement ; destination à approuver |
| Service Worker | Installation / mise à jour | Code du cache applicatif | Même origine ; optionnel pour les fonctions locales |
| Inférence texte | Envoi volontaire d'un message | Contexte sélectionné, historique récent et message courant | Endpoint configuré ; HTTPS obligatoire hors boucle locale |
| Transcription audio | Dictée volontaire | Enregistrement audio | Endpoint configuré ; HTTPS obligatoire hors boucle locale |
| Inférence via gateway d'entreprise | Envoi volontaire d'un message ou d'une dictée | Payload d'inférence autorisé et identité de session | Origine HTTPS exacte, authentification IdP/reverse proxy, alias de modèle et droits administrés côté gateway ; aucune clé fournisseur dans le navigateur |
| Liens documentaires | Clic explicite | Navigation du navigateur | Ouverture volontaire ; pas un appel applicatif en arrière-plan |
| Télémétrie / analytics | Aucun | Aucun | Désactivé / absent par défaut |

## Contrôles opérationnels à compléter

- Capturer les requêtes réseau sur tous les parcours principaux.
- Établir la liste des origines statiques réellement contactées.
- Vérifier l'absence de requêtes de synchronisation des projets.
- Vérifier le comportement sans Service Worker.
- Documenter séparément les flux du fournisseur d'inférence, y compris sa conservation et ses sous-traitants.
- Refaire l'audit après toute intégration de voix, de modèles, de mises à jour ou de connecteurs.
