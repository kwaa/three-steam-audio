root := justfile_directory()
steam := root / "steam-audio"
steam-core := steam / "core"
steam-build := steam-core / "build"
build := root / ".build"
wasm-build := build / "wasm"
bindings-dist := root / "packages/three-steam-audio/src/bindings"

get_dependencies:
  cd "{{steam-build}}" && python get_dependencies.py --platform wasm

patch:
  @if grep -q 'FLATBUFFERS_DELETE_FUNC(TableKeyComparator &operator=(const TableKeyComparator &other))' \
    "{{steam-core}}/deps/flatbuffers/include/flatbuffers/flatbuffers.h"; then \
    echo "flatbuffers patch already applied"; \
  else \
    patch -p0 < "{{root}}/patches/steam-audio/flatbuffers-1.12-table-key-comparator.patch"; \
  fi

build-steam-audio: patch
  cd "{{steam-build}}" && python build.py --platform wasm \
    --minimal \
    --operation ci_build

build-bindings:
  mkdir -p "{{bindings-dist}}"
  node "{{root}}/scripts/generate-types.ts" "{{bindings-dist}}/phonon_bindings.d.ts"
  emcc -O3 \
    -I "{{steam-core}}/bin/include" \
    -I bindings \
    bindings/bindings.c \
    "{{steam-core}}/bin/lib/wasm/libphonon.a" \
    "{{steam-core}}/deps/pffft/lib/wasm/release/libpffft.a" \
    "{{steam-core}}/deps/mysofa/lib/wasm/release/libmysofa.a" \
    "{{steam-core}}/deps/zlib/lib/wasm/release/libz.a" \
    -s WASM=1 \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT=web,worker \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","HEAP32","HEAPU32","HEAPF32","HEAPU8"]' \
    -s EXPORTED_FUNCTIONS='["_malloc","_free"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -o "{{bindings-dist}}/phonon_bindings.js"
