{
  description = "ICARE — agent Pi, serveur Lemonade et interface locale";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      packages = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.writeShellApplication {
            name = "icare";
            runtimeInputs = [ pkgs.nodejs_24 pkgs.coreutils ];
            text = ''
              APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icare-pi"
              mkdir -p "$APP_DIR"
              cp -R ${./pi-runtime}/. "$APP_DIR/"
              cd "$APP_DIR"
              if [ ! -d node_modules/@earendil-works/pi-coding-agent ]; then
                npm install --ignore-scripts --no-audit --no-fund
              fi
              export ICARE_DATA_DIR="${ICARE_DATA_DIR:-$APP_DIR/data}"
              export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$APP_DIR/pi-agent}"
              export LEMONADE_BASE_URL="${LEMONADE_BASE_URL:-http://127.0.0.1:13305/v1}"
              export ICARE_HOST="${ICARE_HOST:-127.0.0.1}"
              export ICARE_PORT="${ICARE_PORT:-8765}"
              exec node src/server.js
            '';
          };
        });
      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/icare";
          meta.description = "Lancer l'agent ICARE avec Pi";
        };
      });
    };
}
