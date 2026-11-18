{ config, pkgs, lib, modulesPath, ... }:
{
  imports = [ (modulesPath + "/virtualisation/qemu-vm.nix") ];

  system.stateVersion = "25.11";
  system.name = "icare";
  networking.hostName = "icare-vm";
  networking.firewall.allowedTCPPorts = [ 8765 ];

  virtualisation = {
    memorySize = 4096;
    cores = 4;
    graphics = false;
    # Réseau invité fermé : seuls les transferts explicitement déclarés subsistent.
    restrictNetwork = true;
    forwardPorts = [
      # Interface web : hôte loopback uniquement -> VM.
      { from = "host"; host.address = "127.0.0.1"; host.port = 8765; guest.port = 8765; }
      # Egress unique de la VM : proxy nono de l'hôte.
      { from = "guest"; guest.address = "10.0.2.100"; guest.port = 43128; host.address = "127.0.0.1"; host.port = 43128; }
    ];
    # Code + node_modules installés sur l'hôte, montés en lecture seule dans la VM.
    sharedDirectories.icare-runtime = {
      source = ''"''${ICARE_RUNTIME_DIR:-$HOME/.local/share/icare-vm/runtime}"'';
      target = "/opt/icare-runtime";
      writable = false;
    };
    # Ancien stockage hôte conservé temporairement pour importer les données créées
    # par les versions qui utilisaient SQLite directement sur VirtioFS.
    sharedDirectories.icare-data = {
      source = ''"''${ICARE_LEGACY_DATA_DIR:-$HOME/.local/share/icare-vm/data}"'';
      target = "/mnt/icare-data";
      writable = true;
    };
    # Journaux du service accessibles sur l'hôte, sans connexion à la console VM.
    sharedDirectories.icare-logs = {
      source = ''"''${ICARE_LOG_DIR:-$HOME/.local/share/icare-vm/logs}"'';
      target = "/var/log/icare-export";
      writable = true;
    };
  };

  users.users.icare = {
    isSystemUser = true;
    group = "icare";
    home = "/var/lib/icare";
    createHome = true;
  };
  users.groups.icare = { };

  # Précrée le répertoire autorisé par nono avant le lancement du service.
  # nono ignore --allow si le chemin n'existe pas encore.
  systemd.tmpfiles.rules = [
    "d /var/lib/icare 0700 icare icare -"
    "d /var/lib/icare/data 0700 icare icare -"
    "d /var/lib/icare/pi-agent 0700 icare icare -"
  ];

  environment.systemPackages = [ pkgs.nodejs_24 pkgs.nono pkgs.cacert ];

  systemd.services.icare = {
    description = "Runtime ICARE sandboxé par nono dans la VM QEMU";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    path = [ pkgs.nodejs_24 pkgs.nono pkgs.coreutils pkgs.cacert ];
    serviceConfig = {
      User = "icare";
      Group = "icare";
      WorkingDirectory = "/opt/icare-runtime";
      Restart = "on-failure";
      RestartSec = 5;
      StateDirectory = "icare";
      StateDirectoryMode = "0700";
      # Conserve stdout/stderr, y compris les erreurs d'initialisation de Pi.
      StandardOutput = "append:/var/log/icare-export/icare.log";
      StandardError = "append:/var/log/icare-export/icare.log";
    };
    script = ''
      export HOME=/var/lib/icare
      # SQLite et l'état Pi résident sur le disque qcow2 persistant, pas sur VirtioFS.
      export ICARE_DATA_DIR=/var/lib/icare/data
      export PI_CODING_AGENT_DIR=/var/lib/icare/pi-agent
      export ICARE_HOST=0.0.0.0
      export ICARE_PORT=8765
      export LEMONADE_BASE_URL=http://127.0.0.1:13305/v1
      # Le proxy nono de l'hôte est l'unique sortie réseau de la VM.
      export HTTP_PROXY=http://10.0.2.100:43128
      export HTTPS_PROXY=http://10.0.2.100:43128
      export http_proxy="$HTTP_PROXY"
      export https_proxy="$HTTPS_PROXY"
      export NO_PROXY=
      export no_proxy=
      export NODE_USE_ENV_PROXY=1
      # Import non destructif des données éventuellement créées par la version
      # qui stockait SQLite et l'agent Pi sur le partage VirtioFS.
      # Le disque qcow2 reste la source de vérité ; aucun fichier existant n'est écrasé.
      if [ ! -e /var/lib/icare/data/icare.sqlite ] && [ -f /mnt/icare-data/icare.sqlite ]; then
        if cp -n /mnt/icare-data/icare.sqlite /var/lib/icare/data/icare.sqlite; then
          for suffix in -wal -shm -journal; do
            if [ -f "/mnt/icare-data/icare.sqlite$suffix" ] && [ ! -e "/var/lib/icare/data/icare.sqlite$suffix" ]; then
              cp -n "/mnt/icare-data/icare.sqlite$suffix" "/var/lib/icare/data/icare.sqlite$suffix" || true
            fi
          done
          echo "[ICARE] Base SQLite importée depuis l'ancien stockage hôte."
        else
          echo "[ICARE] AVERTISSEMENT : import SQLite impossible ; la base locale est conservée." >&2
        fi
      fi
      if [ -d /mnt/icare-data/pi-agent ]; then
        cp -an /mnt/icare-data/pi-agent/. /var/lib/icare/pi-agent/ 2>/dev/null || \
          echo "[ICARE] AVERTISSEMENT : import partiel de l'ancien état Pi." >&2
      fi
      exec nono run --read /opt/icare-runtime --read /nix/store \
        --allow /var/lib/icare/data --allow /var/lib/icare/pi-agent --block-net \
        --open-port 43128 --open-port 8765 \
        -- node src/server.js
    '';
  };

  # La VM ne peut joindre aucun réseau externe directement. QEMU n'autorise
  # qu'un flux vers le proxy nono de l'hôte ; ce proxy n'autorise que Lemonade
  # sur l'hôte et les domaines Discord nécessaires à l'adaptateur.
}
