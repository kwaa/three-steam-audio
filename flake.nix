{
  description = "github:kwaa/three-steam-audio";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "x86_64-darwin"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          emsdkCompat = pkgs.runCommand "emsdk-compat" { } ''
            test -f "${pkgs.emscripten}/share/emscripten/cmake/Modules/Platform/Emscripten.cmake"

            mkdir -p "$out/upstream"
            ln -s "${pkgs.emscripten}/share/emscripten" "$out/upstream/emscripten"
          '';
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = with pkgs; [
              cmake
              gnumake
              gnupatch
              ninja
              emscripten
              just
            ];

            CMAKE_POLICY_VERSION_MINIMUM = "3.5";
            # EMSDK = "${pkgs.emscripten}/share/emscripten";
            EMSDK = emsdkCompat;
            shellHook = ''
              export STEAMAUDIO_ROOT="$PWD/steam-audio"
            '';
          };
        }
      );
    };
}
