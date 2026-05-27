#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
IroHarness installer

Usage:
  install.sh [options]

Options:
  --git                         Install from GitHub checkout (default for now)
  --npm                         Install with npm global package
  --install-method git|npm      Choose install method
  --version <version>           Git branch/tag or npm version/spec (default: main)
  --git-dir <path>              Source checkout directory (default: ~/.iroharness/source)
  --app-dir <path>              Companion app directory (default: ~/iroharness-apps/iroha)
  --character <name>            Character name for generated app (default: Iroha)
  --no-app                      Install CLI only, skip companion app generation
  --no-git-update               Do not update an existing git checkout
  --dry-run                     Print commands without running them
  --help                        Show this help

Environment:
  IROHARNESS_INSTALL_METHOD=git|npm
  IROHARNESS_VERSION=main
  IROHARNESS_GIT_REPO=https://github.com/Go-555/iroharness.git
  IROHARNESS_GIT_DIR=~/.iroharness/source
  IROHARNESS_APP_DIR=~/iroharness-apps/iroha
  IROHARNESS_CHARACTER=Iroha
  IROHARNESS_NO_APP=0|1
  IROHARNESS_GIT_UPDATE=0|1
  IROHARNESS_DRY_RUN=0|1
USAGE
}

expand_path() {
  case "$1" in
    "~") printf '%s\n' "$HOME" ;;
    "~/"*) printf '%s/%s\n' "$HOME" "${1#\~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  if [ "$DRY_RUN" != "1" ]; then
    "$@"
  fi
}

run_in_dir() {
  local dir="$1"
  shift
  printf '+ cd %q &&' "$dir"
  printf ' %q' "$@"
  printf '\n'
  if [ "$DRY_RUN" != "1" ]; then
    (cd "$dir" && "$@")
  fi
}

INSTALL_METHOD="${IROHARNESS_INSTALL_METHOD:-git}"
VERSION="${IROHARNESS_VERSION:-main}"
GIT_REPO="${IROHARNESS_GIT_REPO:-https://github.com/Go-555/iroharness.git}"
GIT_DIR="${IROHARNESS_GIT_DIR:-~/.iroharness/source}"
APP_DIR="${IROHARNESS_APP_DIR:-~/iroharness-apps/iroha}"
CHARACTER="${IROHARNESS_CHARACTER:-Iroha}"
NO_APP="${IROHARNESS_NO_APP:-0}"
GIT_UPDATE="${IROHARNESS_GIT_UPDATE:-1}"
DRY_RUN="${IROHARNESS_DRY_RUN:-0}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --git|--github)
      INSTALL_METHOD="git"
      shift
      ;;
    --npm)
      INSTALL_METHOD="npm"
      shift
      ;;
    --install-method|--method)
      INSTALL_METHOD="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --git-dir|--dir)
      GIT_DIR="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --character)
      CHARACTER="${2:-}"
      shift 2
      ;;
    --no-app)
      NO_APP="1"
      shift
      ;;
    --no-git-update)
      GIT_UPDATE="0"
      shift
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$INSTALL_METHOD" != "git" ] && [ "$INSTALL_METHOD" != "npm" ]; then
  echo "--install-method must be git or npm." >&2
  exit 2
fi

GIT_DIR="$(expand_path "$GIT_DIR")"
APP_DIR="$(expand_path "$APP_DIR")"

need_command node
need_command npm

echo "IroHarness install method: $INSTALL_METHOD"
echo "Version/spec: $VERSION"
echo "App directory: $APP_DIR"
echo "Character: $CHARACTER"

if [ "$INSTALL_METHOD" = "git" ]; then
  need_command git
  if [ -d "$GIT_DIR/.git" ]; then
    echo "Using existing checkout: $GIT_DIR"
    if [ "$GIT_UPDATE" = "1" ]; then
      run_in_dir "$GIT_DIR" git pull --ff-only
    fi
  else
    run mkdir -p "$(dirname "$GIT_DIR")"
    run git clone --branch "$VERSION" "$GIT_REPO" "$GIT_DIR"
  fi
  run_in_dir "$GIT_DIR" npm install
  run_in_dir "$GIT_DIR" npm link
else
  run npm install -g "iroharness@$VERSION"
fi

if [ "$NO_APP" != "1" ]; then
  run mkdir -p "$(dirname "$APP_DIR")"
  if [ -f "$APP_DIR/package.json" ]; then
    echo "Companion app already exists: $APP_DIR"
  else
    if [ "$INSTALL_METHOD" = "git" ]; then
      run node "$GIT_DIR/bin/iroharness.mjs" init "$APP_DIR" --character "$CHARACTER"
    else
      run iroharness init "$APP_DIR" --character "$CHARACTER"
    fi
  fi

  if [ "$INSTALL_METHOD" = "git" ]; then
    run_in_dir "$APP_DIR" npm link iroharness
  else
    run_in_dir "$APP_DIR" npm install
  fi
  run_in_dir "$APP_DIR" npm run doctor
fi

cat <<EOF

IroHarness is ready.

Next:
  cd "$APP_DIR"
  cp .env.example .env
  npm start

StackChan first connection:
  1. Start the Mac mini host:
     cd "$GIT_DIR"
     npm run example:slack-stackchan

  2. Edit firmware config:
     "$GIT_DIR/examples/stackchan-face-poller/data/config.json"

     Use the Mac mini LAN/Tailscale IP, not 127.0.0.1:
       face_url   = http://<MAC_MINI_IP>:4182/stackchan/face
       invoke_url = http://<MAC_MINI_IP>:4182/device/stackchan/invoke

  3. Build/upload with PlatformIO from:
     "$GIT_DIR/examples/stackchan-face-poller"
EOF
