root := justfile_directory()
steam := root / "steam-audio"
steam-core := steam / "core"
steam-build := steam-core / "build"
build := root / ".build"
wasm-build := build / "wasm"
bindings-dist := root / "packages/three-steam-audio/src/bindings"
dependencies-cache-stamp := steam-core / "deps/.dependencies-cache-revision"

get_dependencies:
  @revision="$(git -C "{{steam}}" rev-parse HEAD)"; \
  case "$(uname -s)" in Linux) host_platform=linux-x64;; Darwin) host_platform=osx;; *) host_platform=linux-x64;; esac; \
  if test -f "{{dependencies-cache-stamp}}" \
    && test "$(cat "{{dependencies-cache-stamp}}")" = "$revision" \
    && test -f "{{steam-core}}/deps/flatbuffers/include/flatbuffers/flatbuffers.h" \
    && test -x "{{steam-core}}/deps/flatbuffers/bin/$host_platform/flatc" \
    && test -f "{{steam-core}}/deps/pffft/lib/wasm/release/libpffft.a" \
    && test -f "{{steam-core}}/deps/mysofa/lib/wasm/release/libmysofa.a" \
    && test -f "{{steam-core}}/deps/zlib/lib/wasm/release/libz.a"; then \
    echo "Steam Audio dependencies are already cached ($revision)"; \
  else \
    cd "{{steam-build}}" && python3 get_dependencies.py --platform wasm; \
    printf '%s\n' "$revision" > "{{dependencies-cache-stamp}}"; \
  fi

patch:
  @if grep -q 'FLATBUFFERS_DELETE_FUNC(TableKeyComparator &operator=(const TableKeyComparator &other))' \
    "{{steam-core}}/deps/flatbuffers/include/flatbuffers/flatbuffers.h"; then \
    echo "flatbuffers patch already applied"; \
  else \
    patch -p0 < "{{root}}/patches/steam-audio/flatbuffers-1.12-table-key-comparator.patch"; \
  fi
  @if grep -q '#if defined(__EMSCRIPTEN__)' \
    "{{steam-core}}/src/core/thread_pool.cpp"; then \
    echo "emscripten thread pool patch already applied"; \
  else \
    patch -p0 < "{{root}}/patches/steam-audio/emscripten-synchronous-thread-pool.patch"; \
  fi

build-steam-audio: get_dependencies
  mkdir -p "{{build}}"
  STEAM_AUDIO_REV="$(git -C "{{steam}}" rev-parse HEAD)" \
    nix build --impure .#steam-audio-wasm --out-link "{{build}}/steam-audio-wasm"

build-bindings: build-steam-audio
  mkdir -p "{{bindings-dist}}"
  chmod -R u+w "{{bindings-dist}}"
  cp -r "{{build}}/steam-audio-wasm/bindings/." "{{bindings-dist}}/"
  chmod -R u+w "{{bindings-dist}}"
