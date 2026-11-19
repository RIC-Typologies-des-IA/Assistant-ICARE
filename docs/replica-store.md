# Persistance de l'identité de réplique

Le module `pi-runtime/src/collaboration/replica-store.js` ajoute une identité technique durable par installation dans SQLite.

- La table `local_replica_state` conserve un identifiant de réplique et son compteur monotone.
- `getLocalReplicaIdentity` retourne toujours le même identifiant pour une installation dont la base est conservée.
- `allocateLocalDot` alloue un dot dans une transaction SQLite `BEGIN IMMEDIATE`, en avançant au-delà du compteur durable et de la causalité locale observée.
- Une base réinitialisée ou une installation réinstallée sans sauvegarde doit être considérée comme une nouvelle réplique ; elle ne doit pas réutiliser l'identifiant de l'ancienne installation.
- Cette identité technique ne remplace jamais l'acteur humain/agent. L'authentification et l'attribution métier restent séparées.

Le compteur est maintenant persistant localement. Il n'est pas encore attaché aux événements métier ni exposé à un client distant ; ce branchement interviendra avec la première écriture CRDT persistée.