# Stockage, migration et sauvegarde ICARE

## Source de vérité

Depuis la correction du stockage SQLite sur VirtioFS, les données actives résident dans le disque QEMU persistant :

- Base SQLite et journaux WAL : `/var/lib/icare/data/icare.sqlite`
- État de l'agent Pi : `/var/lib/icare/pi-agent/`
- Disque persistant sur l'hôte : `~/.local/share/icare-vm/runtime/icare.qcow2`

Le répertoire hôte `~/.local/share/icare-vm/data/` est conservé comme source d'import pour les anciennes installations. Il n'est plus utilisé comme emplacement actif de SQLite ou de l'état Pi. La migration copie uniquement les fichiers absents et ne supprime ni ne remplace les données existantes.

Le runtime applicatif reste remplaçable indépendamment du disque QCOW2. Une mise à jour du code ne doit jamais supprimer ou recréer `icare.qcow2`.

## Sauvegarder le disque

Arrêter ICARE proprement avec `Ctrl+C` dans le terminal qui exécute le lanceur, puis depuis le dépôt :

```bash
bash tools/backup-icare
```

Le script refuse de copier le disque si un processus QEMU ICARE est encore actif. Il crée une copie horodatée dans :

```
~/.local/share/icare-vm/backups/
```

Un fichier SHA-256 est créé à côté de chaque sauvegarde. Pour vérifier une copie :

```bash
sha256sum -c ~/.local/share/icare-vm/backups/icare-AAAAmmjj-HHMMSS.qcow2.sha256
```

Les sauvegardes ne sont pas supprimées automatiquement.

## Restaurer une sauvegarde

1. Arrêter ICARE.
2. Conserver le disque courant sous un autre nom, sans le supprimer.
3. Vérifier le SHA-256 de la sauvegarde choisie.
4. Copier la sauvegarde vérifiée vers `~/.local/share/icare-vm/runtime/icare.qcow2`.
5. Relancer ICARE.

Ne jamais restaurer ou remplacer le disque pendant que QEMU l'utilise.

## Migration depuis l'ancien stockage VirtioFS

Au démarrage, la VM importe depuis `~/.local/share/icare-vm/data/` vers son stockage local uniquement si la base locale n'existe pas. Les fichiers de base SQLite et ses éventuels fichiers WAL/SHM sont copiés sans écrasement. L'ancien répertoire `pi-agent` est fusionné sans remplacer les fichiers locaux existants.

Le répertoire hôte historique reste en place après l'import. Il peut être conservé comme sauvegarde supplémentaire jusqu'à vérification de l'historique et des projets dans l'interface ICARE.

## Tests de non-régression

Le test runtime vérifie que :
- SQLite utilise `/var/lib/icare/data` dans la VM ;
- le répertoire Pi est configurable séparément ;
- le sandbox autorise le stockage local persistant ;
- le partage VirtioFS n'est utilisé que comme source de migration et non comme stockage SQLite actif.
