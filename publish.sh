#!/bin/bash
set -euo pipefail

PUBLISH_ONLY=false
PUBLISH_DEBUG="${PUBLISH_DEBUG:-false}"

while [ $# -gt 0 ]; do
  case "$1" in
    -p)
      PUBLISH_ONLY=true
      shift
      ;;
    --debug)
      PUBLISH_DEBUG=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--debug] [-p] \"commit message\""
      echo "  -p: publish-only mode (skip git tag/commit/push and GitHub release steps)"
      echo "  --debug: enable Node HTTP/TLS tracing for Marketplace publish attempts"
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      break
      ;;
    *)
      break
      ;;
  esac
done

if [ "$PUBLISH_ONLY" != true ] && [ -z "${1:-}" ]; then
  echo "Usage: $0 [--debug] [-p] \"commit message\""
  echo "  -p: publish-only mode (skip git tag/commit/push and GitHub release steps)"
  echo "  --debug: enable Node HTTP/TLS tracing for Marketplace publish attempts"
  exit 1
fi

COMMIT_MSG="${1:-}"

# Ensure we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ Error: Not on main branch (currently on: $CURRENT_BRANCH)"
  echo "Run: git checkout main"
  exit 1
fi

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

echo "📦 Publishing version ${VERSION}..."

if [ "$PUBLISH_ONLY" = true ]; then
  echo "⏭️  Publish-only mode enabled: skipping git/github steps."
else
  # Check if version tag already exists locally
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "❌ Error: Tag $TAG already exists locally."
    echo "Did you forget to bump the version in package.json?"
    exit 1
  fi

  # Check if version tag already exists on remote
  if git ls-remote --tags origin | grep -q "refs/tags/$TAG"; then
    echo "❌ Error: Tag $TAG already exists on remote."
    echo "Did you forget to bump the version in package.json?"
    exit 1
  fi
fi

# Compile
echo "🔨 Compiling..."
npm run build || exit 1

# Package
echo "📦 Packaging..."
vsce package || exit 1

# Validate VSIX payload to avoid Marketplace virus-scan false positives
VSIX_FILE="clprompter-${VERSION}.vsix"
echo "🔎 Validating VSIX payload (${VSIX_FILE})..."
if unzip -l "$VSIX_FILE" | grep -Eq "extension/.*\.(tgz|zip|gz|jar|exe|dll|dylib|so)$|extension/node_original/|extension/.*\.vsix$"; then
  echo "❌ Packaging validation failed: VSIX contains archive/binary artifacts that can trigger Marketplace virus checks."
  echo "Update .vscodeignore and repackage before publishing."
  exit 1
fi

if [ "$PUBLISH_ONLY" != true ]; then
  # Git commit/push
  echo "💾 Committing and pushing..."
  git add .
  git commit -m "$COMMIT_MSG" || echo "Nothing to commit"

  # Create tag
  echo "🏷️  Creating tag ${TAG}..."
  git tag "$TAG"

  # Push to GitHub
  echo "⬆️  Pushing to GitHub..."
  git push origin main || exit 1
  git push origin "$TAG" || exit 1
fi

# Publish to Microsoft Marketplace
echo "📤 Publishing to VS Code Marketplace..."
MAX_PUBLISH_ATTEMPTS=1
PUBLISH_ATTEMPT_TIMEOUT_SECONDS="${PUBLISH_ATTEMPT_TIMEOUT_SECONDS:-60}"
PUBLISH_COOLDOWN_SECONDS="${PUBLISH_COOLDOWN_SECONDS:-1500}"
PUBLISH_COOLDOWN_STATE_FILE="${TMPDIR:-/tmp}/clprompter-marketplace-publish.state"
PUBLISH_NODE_DEBUG_FLAGS=""
if [ "$PUBLISH_DEBUG" = true ]; then
  PUBLISH_NODE_DEBUG_FLAGS="http,https,tls"
  echo "🪲 Publish debug enabled: Marketplace publish will emit Node HTTP/TLS traces."
fi
PUBLISH_LOG_FILE=$(mktemp)
PUBLISH_SUCCESS=false

read_cooldown_state() {
  if [ ! -f "$PUBLISH_COOLDOWN_STATE_FILE" ]; then
    return 1
  fi

  local last_failed_epoch now_epoch elapsed_seconds remaining_seconds
  last_failed_epoch=$(cut -d' ' -f1 "$PUBLISH_COOLDOWN_STATE_FILE" 2>/dev/null || true)
  if ! [[ "$last_failed_epoch" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  now_epoch=$(date +%s)
  elapsed_seconds=$(( now_epoch - last_failed_epoch ))
  if [ "$elapsed_seconds" -lt "$PUBLISH_COOLDOWN_SECONDS" ]; then
    remaining_seconds=$(( PUBLISH_COOLDOWN_SECONDS - elapsed_seconds ))
    echo "$remaining_seconds"
    return 0
  fi

  return 1
}

clear_cooldown_state() {
  rm -f "$PUBLISH_COOLDOWN_STATE_FILE"
}

write_cooldown_state() {
  local reason="$1"
  printf '%s %s\n' "$(date +%s)" "$reason" >"$PUBLISH_COOLDOWN_STATE_FILE"
}

if [ -z "${VSCE_PAT:-}" ]; then
  echo "❌ Error: VSCE_PAT environment variable is not set."
  echo "Run: export VSCE_PAT=<your-personal-access-token>"
  exit 1
fi

COOLDOWN_REMAINING_SECONDS="$(read_cooldown_state || true)"
if [ -n "$COOLDOWN_REMAINING_SECONDS" ]; then
  echo "❌ Marketplace publish recently failed. Wait about $(( (COOLDOWN_REMAINING_SECONDS + 59) / 60 )) minute(s) before trying again."
  echo "   This avoids re-running a publish while the Marketplace is still rejecting it."
  exit 1
fi

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  node -e '
const { spawn } = require("child_process");

const timeoutSeconds = Number(process.argv[1]);
const args = process.argv.slice(2);
const nodeDebugFlags = process.env.PUBLISH_NODE_DEBUG_FLAGS || "";

if (args.length === 0) {
  console.error("No command provided.");
  process.exit(1);
}

const childEnv = { ...process.env };
if (nodeDebugFlags) {
  childEnv.NODE_DEBUG = nodeDebugFlags;
}

const child = spawn(args[0], args.slice(1), { stdio: "inherit", env: childEnv });
const timeoutHandle = setTimeout(() => {
  console.error(`Marketplace publish timed out after ${timeoutSeconds}s; terminating the publish process.`);
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5000).unref();
}, timeoutSeconds * 1000);

child.on("exit", (code) => {
  clearTimeout(timeoutHandle);
  process.exit(code === null ? 124 : code);
});

child.on("error", (error) => {
  clearTimeout(timeoutHandle);
  console.error(error.message);
  process.exit(1);
});
' "$timeout_seconds" "$@"
}

for ATTEMPT in $(seq 1 "$MAX_PUBLISH_ATTEMPTS"); do
  echo "📡 Marketplace publish attempt ${ATTEMPT}/${MAX_PUBLISH_ATTEMPTS}..."

  # Publish the already-validated VSIX to avoid re-packaging drift between attempts.
  if run_with_timeout "$PUBLISH_ATTEMPT_TIMEOUT_SECONDS" vsce publish --packagePath "$VSIX_FILE" -p "$VSCE_PAT" >"$PUBLISH_LOG_FILE" 2>&1; then
    cat "$PUBLISH_LOG_FILE"
    PUBLISH_SUCCESS=true
    clear_cooldown_state
    break
  fi

  PUBLISH_EXIT_CODE=$?
  cat "$PUBLISH_LOG_FILE"

  if [ "$PUBLISH_EXIT_CODE" -eq 124 ] || grep -Eiq "request timeout|timed out|etimedout|econnreset|eai_again|socket hang up|temporar|service unavailable|too many requests|http[[:space:]]*429|http[[:space:]]*500|http[[:space:]]*502|http[[:space:]]*503|http[[:space:]]*504|_apis/gallery" "$PUBLISH_LOG_FILE"; then
    write_cooldown_state "timeout-or-transient"
  fi

  break
done

rm -f "$PUBLISH_LOG_FILE"

if [ "$PUBLISH_SUCCESS" != true ]; then
  if [ "$PUBLISH_ONLY" = true ]; then
    echo "❌ Marketplace publish failed after 1 attempt."
  else
    echo "❌ Marketplace publish failed after 1 attempt. Rolling back tag..."
    git tag -d "$TAG"
    git push --delete origin "$TAG"
  fi
  exit 1
fi

# Publish to Open VSX
echo "📤 Publishing to Open VSX..."
npx ovsx publish -p "${OVSX_PAT:-$VSCE_PAT}" || {
  echo "⚠️  Open VSX publish failed (VS Code Marketplace publish succeeded)"
}

if [ "$PUBLISH_ONLY" != true ]; then
  # Create GitHub Release (auto-extracts changelog)
  echo "📝 Creating GitHub Release..."
  if command -v gh &> /dev/null; then
    # Extract changelog entry for this version
    CHANGELOG_ENTRY=$(awk "/## \[${VERSION}\]/,/## \[/" CHANGELOG.md | sed '$d')

    # Create release with .vsix file attached
    gh release create "$TAG" \
      --title "$TAG" \
      --notes "$CHANGELOG_ENTRY" \
      ./clprompter-${VERSION}.vsix || {
      echo "⚠️  GitHub release creation failed (marketplace publish succeeded)"
      echo "📝 Create release manually at: https://github.com/bobcozzi/clPrompter/releases/new?tag=${TAG}"
    }
  else
    echo "⚠️  GitHub CLI (gh) not installed. Opening browser for manual release creation..."
    echo "📝 Copy this changelog entry:"
    echo "----------------------------------------"
    awk "/## \[${VERSION}\]/,/## \[/" CHANGELOG.md | sed '$d'
    echo "----------------------------------------"
    open "https://github.com/bobcozzi/clPrompter/releases/new?tag=${TAG}" 2>/dev/null || {
      echo "📝 Create release manually at: https://github.com/bobcozzi/clPrompter/releases/new?tag=${TAG}"
    }
  fi
fi

echo "✅ Successfully published ${TAG}!"
echo "📦 VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=CozziResearch.clprompter"
echo "📦 Open VSX: https://open-vsx.org/extension/CozziResearch/clprompter"
if [ "$PUBLISH_ONLY" != true ]; then
  echo "📝 GitHub Release: https://github.com/bobcozzi/clPrompter/releases/tag/${TAG}"
fi
