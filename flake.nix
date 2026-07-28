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
            EMSDK = emsdkCompat;
            shellHook = ''
              export STEAMAUDIO_ROOT="$PWD/steam-audio"
            '';
          };
        }
      );

      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          lib = pkgs.lib;
          emsdkCompat = pkgs.runCommand "emsdk-compat" { } ''
            test -f "${pkgs.emscripten}/share/emscripten/cmake/Modules/Platform/Emscripten.cmake"

            mkdir -p "$out/upstream"
            ln -s "${pkgs.emscripten}/share/emscripten" "$out/upstream/emscripten"
          '';
          steamAudioRoot = "${builtins.getEnv "PWD"}/steam-audio/core";
          steamAudioSrc = builtins.path {
            path = steamAudioRoot;
            name = "steam-audio-core-src";
            filter = path: type:
              let
                relative = lib.removePrefix (steamAudioRoot + "/") (toString path);
              in
                relative != ".git"
                && relative != "bin"
                && !(lib.hasPrefix "bin/" relative)
                && relative != "deps-build"
                && !(lib.hasPrefix "deps-build/" relative)
                && relative != "build/wasm-release"
                && !(lib.hasPrefix "build/wasm-release/" relative);
          };
          bindingsSrc = lib.cleanSource ./bindings;
          generateTypesSrc = ./scripts/generate-types.ts;

          steamAudioWasm = pkgs.stdenv.mkDerivation {
            pname = "steam-audio-wasm";
            version =
              let revision = builtins.getEnv "STEAM_AUDIO_REV";
              in if revision == "" then "local" else lib.substring 0 12 revision;
            src = steamAudioSrc;
            nativeBuildInputs = with pkgs; [ cmake ninja python3 emscripten nodejs_24 ];
            dontUseCmakeConfigure = true;

            postPatch = ''
              mkdir -p bindings scripts
              cp -r ${bindingsSrc}/. bindings
              cp ${generateTypesSrc} scripts/generate-types.ts

              if ! grep -q 'FLATBUFFERS_DELETE_FUNC(TableKeyComparator' deps/flatbuffers/include/flatbuffers/flatbuffers.h; then
                patch -p2 < ${./patches/steam-audio/flatbuffers-1.12-table-key-comparator.patch}
              fi
              if ! grep -q '#if defined(__EMSCRIPTEN__)' src/core/thread_pool.cpp; then
                patch -p2 < ${./patches/steam-audio/emscripten-synchronous-thread-pool.patch}
              fi
            '';

            configurePhase = ''
              export EMSDK=${emsdkCompat}
            '';
            buildPhase = ''
              export EMSDK=${emsdkCompat}
              cd build
              python3 build.py --platform wasm --minimal --operation ci_build
              cd ..

              mkdir -p $out/bindings
              ${pkgs.emscripten}/bin/emcc -O3 \
                -I bin/include \
                -I bindings \
                bindings/bindings.c \
                bin/lib/wasm/libphonon.a \
                deps/pffft/lib/wasm/release/libpffft.a \
                deps/mysofa/lib/wasm/release/libmysofa.a \
                deps/zlib/lib/wasm/release/libz.a \
                -s WASM=1 \
                -s EXPORT_ES6=1 \
                -s ENVIRONMENT=web,worker \
                -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","HEAP32","HEAPU32","HEAPF32","HEAPU8"]' \
                -s EXPORTED_FUNCTIONS='["_malloc","_free"]' \
                -s ALLOW_MEMORY_GROWTH=1 \
                -o $out/bindings/phonon_bindings.js

              node scripts/generate-types.ts $out/bindings/phonon_bindings.d.ts
            '';
            installPhase = ''
              mkdir -p $out/core/bin
              cp -r bin/include $out/core/bin/include
              cp -r bin/lib $out/core/bin/lib
            '';
          };
        in
        {
          default = steamAudioWasm;
          steam-audio-wasm = steamAudioWasm;
        }
      );
    };
}
