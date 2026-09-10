#!/bin/bash
set -euo pipefail

PUBLISH_ONLY=false
if [ "${1:-}" = "-p" ]; then
  PUBLISH_ONLY=true
  shift
fi

if [ "$PUBLISH_ONLY" != true ] && [ -z "${1:-}" ]; then
  echo "Usage: $0 [-p] \"commit message\""
  echo "  -p: publish-only mode (skip git tag/commit/push and GitHub release steps)"
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
if [ -z "${VSCE_PAT:-}" ]; then
  echo "❌ Error: VSCE_PAT environment variable is not set."
  echo "Run: export VSCE_PAT=<your-personal-access-token>"
  exit 1
fi

MAX_PUBLISH_ATTEMPTS=3
BASE_RETRY_DELAY_SECONDS=30
JITTER_MAX_SECONDS=20
PUBLISH_LOG_FILE=$(mktemp)
PUBLISH_SUCCESS=false

for ATTEMPT in $(seq 1 "$MAX_PUBLISH_ATTEMPTS"); do
  echo "📡 Marketplace publish attempt ${ATTEMPT}/${MAX_PUBLISH_ATTEMPTS}..."

  # Publish the already-validated VSIX to avoid re-packaging drift between attempts.
  if vsce publish --packagePath "$VSIX_FILE" -p "$VSCE_PAT" >"$PUBLISH_LOG_FILE" 2>&1; then
    cat "$PUBLISH_LOG_FILE"
    PUBLISH_SUCCESS=true
    break
  fi

  cat "$PUBLISH_LOG_FILE"

  if [ "$ATTEMPT" -lt "$MAX_PUBLISH_ATTEMPTS" ] && grep -Eiq "request timeout|timed out|etimedout|econnreset|eai_again|socket hang up|temporar|service unavailable|too many requests|http[[:space:]]*429|http[[:space:]]*500|http[[:space:]]*502|http[[:space:]]*503|http[[:space:]]*504|_apis/gallery" "$PUBLISH_LOG_FILE"; then
    RETRY_DELAY_SECONDS=$(( BASE_RETRY_DELAY_SECONDS * (2 ** (ATTEMPT - 1)) + (RANDOM % JITTER_MAX_SECONDS) ))
    echo "⚠️  Marketplace publish attempt ${ATTEMPT} failed with a transient network/service error. Retrying in ${RETRY_DELAY_SECONDS}s..."
    sleep "$RETRY_DELAY_SECONDS"
    continue
  fi

  break
done

rm -f "$PUBLISH_LOG_FILE"

if [ "$PUBLISH_SUCCESS" != true ]; then
  if [ "$PUBLISH_ONLY" = true ]; then
    echo "❌ Marketplace publish failed after ${MAX_PUBLISH_ATTEMPTS} attempt(s)."
  else
    echo "❌ Marketplace publish failed after ${MAX_PUBLISH_ATTEMPTS} attempt(s). Rolling back tag..."
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
