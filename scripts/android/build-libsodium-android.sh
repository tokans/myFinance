#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Cross-compiles a version-exact static libsodium.a for every Android ABI,
#  using the Android NDK and libsodium's own dist-build scripts.
#
#  Runs INSIDE the Docker image (see Dockerfile.libsodium) — not on Windows.
#  Output: /opt/out/<rust-target-triple>/libsodium.a
#
#  Why this exists: libsodium-sys-stable ships precompiled libsodium for
#  desktop but NOT for Android, so it falls back to autotools (./configure +
#  make) which cannot run on a Windows host. We build the .a in Linux instead
#  and point SODIUM_LIB_DIR at it from the Windows app build.
# ---------------------------------------------------------------------------
set -euo pipefail

: "${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must be set to the NDK directory}"
export NDK_PLATFORM="${NDK_PLATFORM:-android-24}"   # must be <= app minSdk (24)

SRC=/opt/libsodium-stable
OUT=/opt/out
cd "$SRC"

# dist-build script  ->  Rust target triple (what cargo names the ABI)
build_one() {
  local script="$1" rust_target="$2"
  echo "=================================================================="
  echo " libsodium -> ${rust_target}   (dist-build/${script}, ${NDK_PLATFORM})"
  echo "=================================================================="
  rm -rf libsodium-android-*
  ./dist-build/"${script}"
  local a
  a="$(find . -path '*/lib/libsodium.a' | head -n1)"
  if [ -z "$a" ]; then
    echo "ERROR: libsodium.a was not produced for ${rust_target}" >&2
    exit 1
  fi
  mkdir -p "${OUT}/${rust_target}"
  cp "$a" "${OUT}/${rust_target}/libsodium.a"
  # libsodium-sys-stable's build script runs on the Windows HOST, where
  # cfg!(target_env="msvc") is true, so it emits `-l static=libsodium` (not
  # `sodium`) -> rustc looks for liblibsodium.a. Provide that name too.
  cp "$a" "${OUT}/${rust_target}/liblibsodium.a"
  echo "  -> ${OUT}/${rust_target}/{libsodium,liblibsodium}.a  ($(stat -c%s "${OUT}/${rust_target}/libsodium.a") bytes)"
}

build_one android-armv8-a.sh aarch64-linux-android      # arm64-v8a  (real arm devices, arm emulators)
build_one android-x86_64.sh  x86_64-linux-android       # x86_64     (typical Windows emulator)
build_one android-armv7-a.sh armv7-linux-androideabi    # armeabi-v7a
build_one android-x86.sh     i686-linux-android         # x86

echo "=== Done. Built archives: ==="
find "${OUT}" -type f
