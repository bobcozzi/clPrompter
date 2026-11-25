#!/bin/bash
set -euo pipefail

# Microsoft Marketplace publishing is dispatched to GitHub Actions for OIDC authentication.

PUBLISH_ONLY=false
MP_ONLY=false
OPENVSX_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    -p)
      PUBLISH_ONLY=true
      shift
      ;;
    -m|--mp-only|--marketplace-only)
      MP_ONLY=true
      shift
      ;;
    -o|--ovsx-only)
      OPENVSX_ONLY=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [-p] [-m|--mp-only] [-o|--ovsx-only] \"commit message\""
      echo "  -p: publish-only mode (skip git tag/commit/push and GitHub release steps)"
      echo "  -m, --mp-only: publish only to VS Code Marketplace through GitHub Actions"
      echo "  -o, --ovsx-only: publish only to Open VSX (skip the Marketplace workflow)"
      exit 0
      ;;
    --force|--debug)
      echo "❌ Error: $1 is no longer used; Marketplace publishing runs through GitHub Actions."
      exit 1
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

if [ "$MP_ONLY" = true ] && [ "$OPENVSX_ONLY" = true ]; then
  echo "❌ Error: -m/--mp-only and -o/--ovsx-only cannot be used together."
  exit 1
fi

# Convenience behavior: if marketplace-only was requested without a commit
# message, run in publish-only mode automatically.
if { [ "$MP_ONLY" = true ] || [ "$OPENVSX_ONLY" = true ]; } && [ -z "${1:-}" ]; then
  PUBLISH_ONLY=true
fi

if [ "$PUBLISH_ONLY" != true ] && [ -z "${1:-}" ]; then
  echo "Usage: $0 [-p] [-m|--mp-only] [-o|--ovsx-only] \"commit message\""
  echo "  -p: publish-only mode (skip git tag/commit/push and GitHub release steps)"
  echo "  -m, --mp-only: publish only to VS Code Marketplace through GitHub Actions"
  echo "  -o, --ovsx-only: publish only to Open VSX (skip the Marketplace workflow)"
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

if [ "$MP_ONLY" = true ] && [ "$PUBLISH_ONLY" = true ]; then
  echo "⏭️  Marketplace-only mode without commit message: using publish-only flow."
fi
if [ "$OPENVSX_ONLY" = true ] && [ "$PUBLISH_ONLY" = true ]; then
  echo "⏭️  Open VSX-only mode without commit message: using publish-only flow."
fi

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

# Ensure the VSCE CLI used to create the VSIX is up to date before packaging.
echo "🧰 Updating VSCE CLI..."
if command -v npm >/dev/null 2>&1; then
  npm install -g @vscode/vsce@latest || echo "⚠️  VSCE update check failed; continuing with the currently installed version."
fi
if command -v vsce >/dev/null 2>&1; then
  vsce --version || true
fi

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

# Publish to Open VSX before queueing the independent Marketplace workflow.
if [ "$MP_ONLY" = true ]; then
  echo "⏭️  Marketplace-only mode enabled: skipping Open VSX publish."
else
  if [ -z "${OVSX_PAT:-}" ]; then
    echo "❌ Error: OVSX_PAT environment variable is not set."
    echo "Run: export OVSX_PAT=<your-open-vsx-token>"
    exit 1
  fi
  echo "📤 Publishing to Open VSX..."
  npx ovsx publish --packagePath "$VSIX_FILE" -p "$OVSX_PAT" || {
    echo "⚠️  Open VSX publish failed (continuing to GitHub Marketplace workflow)"
  }
fi

# Publish to Microsoft Marketplace through GitHub Actions Trusted Publishing.
if [ "$OPENVSX_ONLY" = true ]; then
  echo "⏭️  Open VSX-only mode enabled: skipping VS Code Marketplace workflow."
else
  if ! command -v gh >/dev/null 2>&1; then
    echo "❌ GitHub CLI (gh) is required to trigger Marketplace publishing."
    echo "Install gh, authenticate with 'gh auth login', then run this command again."
    exit 1
  fi

  if [ "$PUBLISH_ONLY" = true ]; then
    PUBLISH_REF="$CURRENT_BRANCH"
  else
    PUBLISH_REF="$TAG"
  fi

  echo "📤 Queuing VS Code Marketplace publishing from GitHub Actions ($PUBLISH_REF)..."
  gh workflow run publish-marketplace.yml --ref "$PUBLISH_REF"
fi

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
      echo "⚠️  GitHub release creation failed (Marketplace workflow was queued)"
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

echo "✅ Release steps completed for ${TAG}. Check the GitHub Actions run for Marketplace status."
if [ "$OPENVSX_ONLY" != true ]; then
  echo "📦 VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=CozziResearch.clprompter"
fi
if [ "$MP_ONLY" != true ]; then
  echo "📦 Open VSX: https://open-vsx.org/extension/CozziResearch/clprompter"
fi
if [ "$PUBLISH_ONLY" != true ]; then
  echo "📝 GitHub Release: https://github.com/bobcozzi/clPrompter/releases/tag/${TAG}"
fi
