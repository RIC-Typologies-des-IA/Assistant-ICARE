{
  description = "ICARE — runtime Pi, Lemonade et sandbox nono (Linux VM / macOS natif)";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      isLinux = system: nixpkgs.lib.hasSuffix "-linux" system;
      packages = forAllSystems (system:
        let
          packageSet = if system == "x86_64-darwin" then nixpkgs-darwin-intel else nixpkgs;
          pkgs = import packageSet { inherit system; };
          macLauncher = pkgs.writeShellApplication {
            name = "icare";
            runtimeInputs = [ pkgs.nodejs_24 pkgs.nono pkgs.coreutils pkgs.curl ];
            text = ''
              APP_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-pi"
              DATA_DIR="''${ICARE_DATA_DIR:-$APP_DIR/data}"
              LOG_DIR="''${XDG_STATE_HOME:-$HOME/.local/state}/icare/logs"
              mkdir -p "$APP_DIR" "$DATA_DIR" "$LOG_DIR"
              chmod 700 "$DATA_DIR" "$LOG_DIR"
              cp -R ${./pi-runtime}/. "$APP_DIR/"
              cd "$APP_DIR"
              if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then
                echo "Installation des dépendances ICARE..."
                npm install --ignore-scripts --no-audit --no-fund
              fi
              export ICARE_DATA_DIR="$DATA_DIR"
              export PI_CODING_AGENT_DIR="''${PI_CODING_AGENT_DIR:-$DATA_DIR/pi-agent}"
              export LEMONADE_BASE_URL="''${LEMONADE_BASE_URL:-http://127.0.0.1:13305/v1}"
              export ICARE_HOST=127.0.0.1 ICARE_PORT=8765 ICARE_LOG_DIR="$LOG_DIR"
              nono proxy --listen 127.0.0.1 --port 43128 --no-auth \
                --allow-domain 'http://127.0.0.1:13305/v1/**' \
                --allow-domain 'https://discord.com/api/**' \
                --allow-domain gateway.discord.gg &
              PROXY_PID=$!
              cleanup() { kill "$PROXY_PID" 2>/dev/null || true; }
              trap cleanup EXIT INT TERM
              sleep 1
              kill -0 "$PROXY_PID" 2>/dev/null || { echo "Le proxy nono n'a pas démarré." >&2; exit 1; }
              echo "Interface ICARE : http://127.0.0.1:8765"
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
              trap 'kill "$BROWSER_PID" "$PROXY_PID" 2>/dev/null || true' EXIT INT TERM
              export HTTP_PROXY=http://127.0.0.1:43128 HTTPS_PROXY=http://127.0.0.1:43128
              export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" NO_PROXY= no_proxy= NODE_USE_ENV_PROXY=1
              nono run --read "$APP_DIR" --read /nix/store \
                --allow "$DATA_DIR" --allow "$LOG_DIR" --block-net \
                --open-port 43128 --open-port 8765 -- node src/server.js &
              RUNTIME_PID=$!
              wait "$RUNTIME_PID"
            '';
          };
        in
          if isLinux system then
            let
              vm = nixpkgs.lib.nixosSystem { inherit system; modules = [ ./nixos/icare-vm.nix ]; };
              vmRunner = vm.config.system.build.vm;
              vmLauncher = pkgs.writeShellApplication {
                name = "icare-vm";
                runtimeInputs = [ pkgs.nodejs_24 pkgs.nono pkgs.coreutils pkgs.netcat-openbsd pkgs.curl pkgs.xdg-utils ];
                text = ''
                  APP_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-vm/runtime"
                  LOG_DIR="''${XDG_DATA_HOME:-$HOME/.local/share}/icare-vm/logs"
                  mkdir -p "$APP_DIR" "$LOG_DIR"
                  chmod 1777 "$LOG_DIR"
                  export ICARE_LOG_DIR="$LOG_DIR"
                  cp -R ${./pi-runtime}/. "$APP_DIR/"
                  cd "$APP_DIR"
                  if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then npm install --ignore-scripts --no-audit --no-fund; fi
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
                  [ "$READY" -eq 1 ] || { echo "Le proxy nono n'a pas démarré." >&2; exit 1; }
                  echo "Interface ICARE : http://127.0.0.1:8765"
                  if [ -n "$DISPLAY$WAYLAND_DISPLAY" ] && command -v xdg-open >/dev/null 2>&1; then
                    (for _ in $(seq 1 90); do
                      if curl -fsS http://127.0.0.1:8765/api/status >/dev/null 2>&1; then xdg-open http://127.0.0.1:8765 >/dev/null 2>&1 || true; exit 0; fi
                      sleep 1
                    done) &
                    BROWSER_PID=$!
                    trap 'kill "$BROWSER_PID" "$PROXY_PID" 2>/dev/null || true' EXIT INT TERM
                  fi
                  ${vmRunner}/bin/run-icare-vm
                '';
              };
            in { default = vmLauncher; vm = vmRunner; macos = macLauncher; }
          else { default = macLauncher; macos = macLauncher; }
      );
    in {
      nixosConfigurations = (forAllSystems (system:
        if isLinux system then { icare-vm = nixpkgs.lib.nixosSystem { inherit system; modules = [ ./nixos/icare-vm.nix ]; }; } else { }))
        // { icare-vm = nixpkgs.lib.nixosSystem { system = "x86_64-linux"; modules = [ ./nixos/icare-vm.nix ]; }; };
      inherit packages;
      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${packages.${system}.default}/bin/" + (if isLinux system then "icare-vm" else "icare");
          meta.description = if isLinux system then "ICARE dans une VM NixOS/QEMU confinée par nono" else "ICARE natif sur macOS dans un sandbox nono/Seatbelt";
        };
      });
    };
}
