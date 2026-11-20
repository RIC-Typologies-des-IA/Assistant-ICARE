{
  description = "ICARE — Pi, Lemonade, VM QEMU et confinement nono sur Linux ; Seatbelt sur macOS";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.nixpkgs-darwin-intel.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
  outputs = { self, nixpkgs, nixpkgs-darwin-intel }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      isLinux = system: nixpkgs.lib.hasSuffix "-linux" system;
      packageSet = system: if system == "x86_64-darwin" then nixpkgs-darwin-intel else nixpkgs;
      makeVm = system: nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [ ./nixos/icare-vm.nix ];
      };
      vmConfigs = {
        "x86_64-linux" = makeVm "x86_64-linux";
        "aarch64-linux" = makeVm "aarch64-linux";
      };
      packages = forAllSystems (system:
        let pkgs = import (packageSet system) { inherit system; };
        in if isLinux system then
          let
            vm = vmConfigs.${system};
            vmRunner = vm.config.system.build.vm;
            vmLauncher = pkgs.writeShellApplication {
              name = "icare-vm";
              runtimeInputs = [ pkgs.nodejs_24 pkgs.nono pkgs.coreutils pkgs.netcat-openbsd pkgs.curl pkgs.xdg-utils ];
              text = ''
                APP_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-vm/runtime"
                LOG_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-vm/logs"
                DATA_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-vm/data"
                mkdir -p "$(dirname "$APP_DIR")" "$LOG_DIR" "$DATA_DIR"
                chmod 1777 "$DATA_DIR" "$LOG_DIR"
                export ICARE_LEGACY_DATA_DIR="$DATA_DIR"
                if [ -d "$APP_DIR" ]; then
                  UNWRITABLE_PATH="$(find "$APP_DIR" ! -writable -print -quit 2>/dev/null || true)"
                  if [ -n "$UNWRITABLE_PATH" ]; then
                    BACKUP_DIR="$APP_DIR.backup.$(date +%Y%m%d%H%M%S)"
                    mv "$APP_DIR" "$BACKUP_DIR"
                    echo "Ancien runtime non modifiable sauvegardé dans : $BACKUP_DIR"
                  fi
                fi
                mkdir -p "$APP_DIR"
                export ICARE_LOG_DIR="$LOG_DIR"
                cp -R ${./pi-runtime}/. "$APP_DIR/"
                cd "$APP_DIR"
                if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then
                  npm install --ignore-scripts --no-audit --no-fund
                fi
                export ICARE_RUNTIME_DIR="$APP_DIR"
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
            hostRuntime = pkgs.writeShellApplication {
              name = "icare-host-runtime";
              runtimeInputs = [ pkgs.nodejs_24 pkgs.coreutils ];
              text = ''
                APP_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-pi"
                DATA_DIR="''${ICARE_DATA_DIR:-$APP_DIR/data}"
                mkdir -p "$(dirname "$APP_DIR")" "$DATA_DIR"
                chmod 700 "$DATA_DIR"
                if [ -d "$APP_DIR" ]; then
                  UNWRITABLE_PATH="$(find "$APP_DIR" ! -writable -print -quit 2>/dev/null || true)"
                  if [ -n "$UNWRITABLE_PATH" ]; then
                    BACKUP_DIR="$APP_DIR.backup.$(date +%Y%m%d%H%M%S)"
                    mv "$APP_DIR" "$BACKUP_DIR"
                    echo "Ancien runtime non modifiable sauvegardé dans : $BACKUP_DIR"
                  fi
                fi
                mkdir -p "$APP_DIR"
                cp -R ${./pi-runtime}/. "$APP_DIR/"
                cd "$APP_DIR"
                if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then
                  npm install --ignore-scripts --no-audit --no-fund
                fi
                export ICARE_DATA_DIR="$DATA_DIR"
                export PI_CODING_AGENT_DIR="''${PI_CODING_AGENT_DIR:-$DATA_DIR/pi-agent}"
                export LEMONADE_BASE_URL="''${LEMONADE_BASE_URL:-http://127.0.0.1:13305/v1}"
                export ICARE_HOST="''${ICARE_HOST:-127.0.0.1}"
                export ICARE_PORT="''${ICARE_PORT:-8765}"
                exec node src/server.js
              '';
            };
          in { default = vmLauncher; vm = vmRunner; host = hostRuntime; }
        else
          let
            macLauncher = pkgs.writeShellApplication {
              name = "icare";
              runtimeInputs = [ pkgs.nodejs_24 pkgs.nono pkgs.coreutils pkgs.curl ];
              text = ''
                APP_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-pi"
                DATA_DIR="''${ICARE_DATA_DIR:-''${XDG_DATA_HOME:-$HOME/.local/share}/icare-pi-data}"
                LOG_DIR="''${XDG_STATE_HOME:-$HOME/.local/state}/icare/logs"
                mkdir -p "$APP_DIR" "$DATA_DIR" "$LOG_DIR"
                chmod 700 "$DATA_DIR" "$LOG_DIR"
                if [ -d "$APP_DIR" ]; then
                  UNWRITABLE_PATH="$(find "$APP_DIR" ! -writable -print -quit 2>/dev/null || true)"
                  if [ -n "$UNWRITABLE_PATH" ]; then
                    BACKUP_DIR="$APP_DIR.backup.$(date +%Y%m%d%H%M%S)"
                    mv "$APP_DIR" "$BACKUP_DIR"
                    echo "Ancien runtime non modifiable sauvegardé dans : $BACKUP_DIR"
                  fi
                fi
                mkdir -p "$APP_DIR"
                cp -R ${./pi-runtime}/. "$APP_DIR/"
                cd "$APP_DIR"
                if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then
                  echo "Installation des dépendances ICARE..."
                  npm install --ignore-scripts --no-audit --no-fund
                fi
                export ICARE_DATA_DIR="$DATA_DIR"
                export PI_CODING_AGENT_DIR="''${PI_CODING_AGENT_DIR:-$DATA_DIR/pi-agent}"
                export LEMONADE_BASE_URL="''${LEMONADE_BASE_URL:-http://127.0.0.1:13305/v1}"
                export ICARE_HOST="''${ICARE_HOST:-127.0.0.1}"
                export ICARE_PORT="''${ICARE_PORT:-8765}"
                export ICARE_LOG_DIR="$LOG_DIR"
                nono proxy --listen 127.0.0.1 --port 43128 --no-auth \
                  --allow-domain 'http://127.0.0.1:13305/v1/**' \
                  --allow-domain 'https://discord.com/api/**' \
                  --allow-domain gateway.discord.gg &
                PROXY_PID=$!
                cleanup() { kill "$PROXY_PID" 2>/dev/null || true; }
                trap cleanup EXIT INT TERM
                READY=0
                for _ in $(seq 1 30); do
                  if kill -0 "$PROXY_PID" 2>/dev/null; then READY=1; break; fi
                  sleep 1
                done
                if [ "$READY" -ne 1 ]; then
                  echo "Le proxy nono n'a pas démarré sur 127.0.0.1:43128." >&2
                  exit 1
                fi
                export HTTP_PROXY=http://127.0.0.1:43128 HTTPS_PROXY=http://127.0.0.1:43128
                export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" NO_PROXY= no_proxy= NODE_USE_ENV_PROXY=1
                nono run --read "$APP_DIR" --read /nix/store \
                  --allow "$DATA_DIR" --allow "$LOG_DIR" --block-net \
                  --open-port 43128 --open-port 8765 -- node src/server.js &
                RUNTIME_PID=$!
                (
                  for _ in $(seq 1 90); do
                    if curl -fsS http://127.0.0.1:8765/api/status >/dev/null 2>&1; then
                      /usr/bin/open http://127.0.0.1:8765 >/dev/null 2>&1 || true
                      exit 0
                    fi
                    sleep 1
                  done
                ) &
                BROWSER_PID=$!
                trap 'kill "$BROWSER_PID" "$RUNTIME_PID" "$PROXY_PID" 2>/dev/null || true' EXIT INT TERM
                wait "$RUNTIME_PID"
              '';
            };
          in { default = macLauncher; macos = macLauncher; }
      );
    in {
      nixosConfigurations = {
        icare-vm = vmConfigs."x86_64-linux";
        icare-vm-aarch64 = vmConfigs."aarch64-linux";
      };
      inherit packages;
      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${packages.${system}.default}/bin/" + (if isLinux system then "icare-vm" else "icare");
          meta.description = if isLinux system
            then "ICARE dans une VM NixOS/QEMU confinée par nono"
            else "ICARE natif sur macOS dans un sandbox nono/Seatbelt";
        };
      });
    };
}
