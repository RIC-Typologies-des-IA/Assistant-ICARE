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
    # QEMU expose l'interface uniquement sur le loopback de l'hôte.
    # Le flux inverse est un port QEMU dédié vers Lemonade sur l'hôte :
    # le serveur Lemonade peut donc rester lié à 127.0.0.1.
    forwardPorts = [
      { from = "host"; host.address = "127.0.0.1"; host.port = 8765; guest.port = 8765; }
      { from = "guest"; guest.address = "10.0.2.100"; guest.port = 13305; host.address = "127.0.0.1"; host.port = 13305; }
    ];
  };

  users.users.icare = {
    isSystemUser = true;
    group = "icare";
    home = "/var/lib/icare";
    createHome = true;
  };
  users.groups.icare = { };

  environment.etc."icare-runtime".source = ../pi-runtime;
  environment.systemPackages = [ pkgs.nodejs_24 pkgs.nono pkgs.cacert ];

  systemd.services.icare = {
    description = "Runtime ICARE isolé par nono dans la VM QEMU";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    path = [ pkgs.nodejs_24 pkgs.nono pkgs.coreutils pkgs.cacert ];
    serviceConfig = {
      User = "icare";
      Group = "icare";
      WorkingDirectory = "/var/lib/icare/runtime";
      Restart = "on-failure";
      RestartSec = 5;
      StateDirectory = "icare";
      StateDirectoryMode = "0700";
    };
    script = ''
      install -d -m 0700 /var/lib/icare/runtime
      cp -R /etc/icare-runtime/. /var/lib/icare/runtime/
      cd /var/lib/icare/runtime
      if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then
        # Installation initiale des dépendances, avant le lancement sandboxé.
        npm install --ignore-scripts --no-audit --no-fund
      fi
      export HOME=/var/lib/icare
      export ICARE_DATA_DIR=/var/lib/icare/data
      export PI_CODING_AGENT_DIR=/var/lib/icare/pi-agent
      export ICARE_HOST=0.0.0.0
      export ICARE_PORT=8765
      export LEMONADE_BASE_URL=http://10.0.2.100:13305/v1
      # Node 24 utilise le proxy HTTP(S) fourni par nono.
      export NODE_USE_ENV_PROXY=1
      exec nono run --allow-cwd --allow /var/lib/icare \
        --allow-domain 'http://10.0.2.100:13305/v1/**' \
        --allow-domain discord.com \
        --allow-domain gateway.discord.gg \
        --listen-port 8765 \
        -- node src/server.js
    '';
  };

  # La VM garde un réseau NAT pour le proxy nono. Le processus ICARE, lui,
  # ne peut sortir que vers Lemonade et les domaines Discord explicitement
  # autorisés ci-dessus. Ne pas ajouter de réseau direct au processus sandboxé.
}
