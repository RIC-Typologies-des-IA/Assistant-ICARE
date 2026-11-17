{
description = "ICARE — Pi, Lemonade, VM QEMU et confinement nono";
inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
outputs = { self, nixpkgs }:
  let
    systems = [ "x86_64-linux" ];
    forAllSystems = nixpkgs.lib.genAttrs systems;
    vmSystem = "x86_64-linux";
    vm = nixpkgs.lib.nixosSystem {
      system = vmSystem;
      modules = [ ./nixos/icare-vm.nix ];
    };
    vmRunner = vm.config.system.build.vm;
    hostPkgs = import nixpkgs { system = vmSystem; };
    vmLauncher = hostPkgs.writeShellApplication {
      name = "icare-vm";
      runtimeInputs = [ hostPkgs.nodejs_24 hostPkgs.nono hostPkgs.coreutils hostPkgs.netcat-openbsd hostPkgs.curl hostPkgs.xdg-utils ];
      text = ''
        APP_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-vm/runtime"
        LOG_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-vm/logs"
        mkdir -p "$APP_DIR" "$LOG_DIR"
        # Le répertoire parent est privé dans le home ; le sticky bit permet
        # au compte de service invité d'écrire les journaux via virtiofs.
        chmod 1777 "$LOG_DIR"
        export ICARE_LOG_DIR="$LOG_DIR"
        cp -R ${./pi-runtime}/. "$APP_DIR/"
        cd "$APP_DIR"
        if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then
          npm install --ignore-scripts --no-audit --no-fund
        fi
        export ICARE_RUNTIME_DIR="$APP_DIR"
        # Proxy hôte : seuls Lemonade et les points d'accès Discord sont autorisés.
        nono proxy --listen 127.0.0.1 --port 43128 --no-auth \
          --allow-domain 'http://127.0.0.1:13305/v1/**' \
          --allow-domain 'https://discord.com/api/**' \
          --allow-domain gateway.discord.gg &
        PROXY_PID=$!
        cleanup() { kill "$PROXY_PID" 2>/dev/null || true; }
        trap cleanup EXIT INT TERM
        READY=0
        for _ in $(seq 1 30); do
          if kill -0 "$PROXY_PID" 2>/dev/null && nc -z 127.0.0.1 43128; then READY=1; break; fi
          sleep 1
        done
        if [ "$READY" -ne 1 ]; then
          echo "Le proxy nono n'a pas démarré sur 127.0.0.1:43128." >&2
          exit 1
        fi
        echo "Interface ICARE : http://127.0.0.1:8765"
        if [ -n "$DISPLAY$WAYLAND_DISPLAY" ] && command -v xdg-open >/dev/null 2>&1; then
          (for _ in $(seq 1 90); do
            if curl -fsS http://127.0.0.1:8765/api/status >/dev/null 2>&1; then
              xdg-open http://127.0.0.1:8765 >/dev/null 2>&1 || true
              exit 0
            fi
            sleep 1
          done) &
          BROWSER_PID=$!
          trap 'kill "$BROWSER_PID" "$PROXY_PID" 2>/dev/null || true' EXIT INT TERM
        fi
        "${vmRunner}/bin/run-icare-vm"
      '';
    };
  in {
    nixosConfigurations.icare-vm = vm;
    packages = forAllSystems (system:
      let pkgs = import nixpkgs { inherit system; };
      in {
        default = vmLauncher;
        vm = vmRunner;
        host = pkgs.writeShellApplication {
          name = "icare-host-runtime";
          runtimeInputs = [ pkgs.nodejs_24 pkgs.coreutils ];
          text = ''
            APP_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-pi"
            mkdir -p "$APP_DIR"
            cp -R ${./pi-runtime}/. "$APP_DIR/"
            cd "$APP_DIR"
            if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then npm install --ignore-scripts --no-audit --no-fund; fi
            export ICARE_DATA_DIR="''${ICARE_DATA_DIR:-$APP_DIR/data}"
            export PI_CODING_AGENT_DIR="''${PI_CODING_AGENT_DIR:-$APP_DIR/pi-agent}"
            export LEMONADE_BASE_URL="''${LEMONADE_BASE_URL:-http://127.0.0.1:13305/v1}"
            export ICARE_HOST="''${ICARE_HOST:-127.0.0.1}"
            export ICARE_PORT="''${ICARE_PORT:-8765}"
            exec node src/server.js
          '';
        };
      }
    );
    apps = forAllSystems (system: {
      default = { type = "app"; program = "${vmLauncher}/bin/icare-vm"; meta.description = "Lancer ICARE dans une VM QEMU, avec réseau filtré par nono"; };
      host = { type = "app"; program = "${self.packages.${system}.host}/bin/icare-host-runtime"; meta.description = "Ancien lancement direct sur l'hôte"; };
    });
  };
}
