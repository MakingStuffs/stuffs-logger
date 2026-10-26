#!/usr/bin/env bash
#
# The release pipeline: reads the Conventional Commits since the last stable
# tag, works out the next version, writes it into every manifest, updates
# CHANGELOG.md, builds and audits the published packages, tags, publishes to
# npm and cuts a GitHub Release.
#
#   main    -> x.y.z        npm dist-tag `latest`   git tag vX.Y.Z
#   *-rc    -> x.y.z-rc.N   npm dist-tag `rc`       git tag vX.Y.Z-rc.N
#
# THE BUMP, from every commit since the last stable tag:
#
#   `type!:` subject, or a `BREAKING CHANGE:` footer  -> major
#   `feat:`                                           -> minor
#   `fix:`, `perf:`, `revert:`                        -> patch
#   anything else (chore, docs, ci, refactor, ...)    -> no release
#
# While the version is 0.x a breaking change bumps the MINOR, not the major:
# leaving 0.x is a decision, not something a `!` should make by accident.
#
# THE ORDER IS THE POINT. A tag with no matching npm version is the one state
# a re-run cannot repair, so everything that can fail — the npm credential,
# the build, the tarball audit — runs before the tag exists, and the publish
# is the only step after the push.
#
# Must run from CI (`CI=true`). `--dry-run` prints the next version and its
# notes without writing anything, and runs anywhere:
#
#   pnpm release:dry-run
#
# Bash 3.2 compatible on purpose, so the dry run works on a stock macOS shell.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="https://registry.npmjs.org"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

fail() {
  echo "release: $*" >&2
  exit 1
}

cd "$(git rev-parse --show-toplevel)"

# --- Where we are releasing from -------------------------------------------

BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
case "$BRANCH" in
  main) DIST_TAG="latest" ;;
  *-rc) DIST_TAG="rc" ;;
  *) fail "releases are cut from main or a *-rc branch, not '$BRANCH'" ;;
esac

# The last STABLE tag reachable from here. An rc branch measures from the
# stable line too, so its rc.N numbers count towards the next stable version.
if ! BASE_TAG="$(git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude 'v*-*' HEAD 2>/dev/null)"; then
  fail "no stable vX.Y.Z tag is reachable from HEAD. Tag the baseline first: git tag v0.1.0 <commit> && git push origin v0.1.0"
fi
BASE_VERSION="${BASE_TAG#v}"
[[ "$BASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "${BASE_TAG} is not a vX.Y.Z tag"
IFS=. read -r MAJOR MINOR PATCH <<<"$BASE_VERSION"

REPO_URL="$(node -p 'require("./package.json").repository.url' | sed -e 's/^git+//' -e 's/\.git$//')"

# --- Read the commits ------------------------------------------------------

BUMP=0 # 0 none, 1 patch, 2 minor, 3 major
BREAKING_NOTES=""
FEATURE_NOTES=""
FIX_NOTES=""
PERF_NOTES=""
REVERT_NOTES=""

HEADER_PATTERN='^([a-zA-Z]+)(\(([^)]*)\))?(!)?: (.+)$'
FOOTER_PATTERN='^BREAKING[ -]CHANGE: (.+)$'

# One record per commit: sha, subject and body, separated by the ASCII unit
# and record separators so no commit message can split a field.
while IFS=$'\x1f' read -r -d $'\x1e' sha subject body; do
  sha="${sha#$'\n'}"

  if [[ ! "$subject" =~ $HEADER_PATTERN ]]; then
    continue
  fi
  type="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
  scope="${BASH_REMATCH[3]}"
  bang="${BASH_REMATCH[4]}"
  description="${BASH_REMATCH[5]}"

  prefix="* "
  if [[ -n "$scope" ]]; then
    prefix="* **${scope}:** "
  fi
  entry="${prefix}${description} ([${sha:0:7}](${REPO_URL}/commit/${sha}))"

  breaking_text=""
  while IFS= read -r line; do
    if [[ "$line" =~ $FOOTER_PATTERN ]]; then
      breaking_text="${BASH_REMATCH[1]}"
      break
    fi
  done <<<"$body"
  if [[ -n "$bang" && -z "$breaking_text" ]]; then
    breaking_text="$description"
  fi

  if [[ -n "$breaking_text" ]]; then
    BUMP=3
    BREAKING_NOTES+="${prefix}${breaking_text}"$'\n'
  fi

  case "$type" in
    feat)
      FEATURE_NOTES+="${entry}"$'\n'
      if ((BUMP < 2)); then BUMP=2; fi
      ;;
    fix)
      FIX_NOTES+="${entry}"$'\n'
      if ((BUMP < 1)); then BUMP=1; fi
      ;;
    perf)
      PERF_NOTES+="${entry}"$'\n'
      if ((BUMP < 1)); then BUMP=1; fi
      ;;
    revert)
      REVERT_NOTES+="${entry}"$'\n'
      if ((BUMP < 1)); then BUMP=1; fi
      ;;
  esac
done < <(git log --reverse --no-merges --format='%H%x1f%s%x1f%b%x1e' "${BASE_TAG}..HEAD")

if ((BUMP == 0)); then
  echo "release: nothing to release — no feat, fix, perf, revert or breaking commit since ${BASE_TAG}"
  exit 0
fi

# --- The next version ------------------------------------------------------

if ((BUMP == 3 && MAJOR > 0)); then
  VERSION="$((MAJOR + 1)).0.0"
elif ((BUMP >= 2)); then
  VERSION="${MAJOR}.$((MINOR + 1)).0"
else
  VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
fi

if [[ "$DIST_TAG" == "rc" ]]; then
  LAST_RC="$(git tag --list "v${VERSION}-rc.*" | sed 's/.*-rc\.//' | grep -E '^[0-9]+$' | sort -n | tail -n 1 || true)"
  VERSION="${VERSION}-rc.$((${LAST_RC:-0} + 1))"
fi
TAG="v${VERSION}"

if git rev-parse --quiet --verify "refs/tags/${TAG}" >/dev/null; then
  fail "${TAG} already exists"
fi

# --- The notes -------------------------------------------------------------

# An explicit template, because macOS's mktemp ignores TMPDIR without one.
NOTES_FILE="$(mktemp "${TMPDIR:-/tmp}/release-notes.XXXXXX")"
trap 'rm -f "$NOTES_FILE"' EXIT

notes_section() {
  if [[ -n "$2" ]]; then
    printf '\n### %s\n\n%s' "$1" "$2"
  fi
}

{
  printf '## %s (%s)\n' "$VERSION" "$(date -u +%Y-%m-%d)"
  notes_section "⚠ BREAKING CHANGES" "$BREAKING_NOTES"
  notes_section "Features" "$FEATURE_NOTES"
  notes_section "Bug Fixes" "$FIX_NOTES"
  notes_section "Performance Improvements" "$PERF_NOTES"
  notes_section "Reverts" "$REVERT_NOTES"
} >"$NOTES_FILE"

echo "release: ${BASE_TAG} -> ${TAG} (npm dist-tag: ${DIST_TAG})"
echo
cat "$NOTES_FILE"

if [[ "$DRY_RUN" == true ]]; then
  exit 0
fi

# --- Everything that can fail, before the tag ------------------------------

[[ "${CI:-}" == "true" ]] || fail "publishing runs from CI only; use --dry-run locally"
[[ -n "${GITHUB_TOKEN:-}" ]] || fail "GITHUB_TOKEN is not set"
git diff --quiet HEAD || fail "the working tree has uncommitted changes"

# Fails closed when the npm credential is missing, expired or revoked.
pnpm whoami --registry "$REGISTRY" >/dev/null || fail "npm rejected the credential (pnpm whoami)"

node "${SCRIPT_DIR}/sync-versions.mjs" "$VERSION"

# The new entry goes above the newest existing one, below the file's header.
awk -v notes="$NOTES_FILE" '
  !done && /^## / { while ((getline line < notes) > 0) print line; print ""; done = 1 }
  { print }
  END { if (!done) { print ""; while ((getline line < notes) > 0) print line } }
' CHANGELOG.md >CHANGELOG.md.next
mv CHANGELOG.md.next CHANGELOG.md

pnpm --filter @stuffs-logger/core --filter @stuffs-logger/sdk build
node "${SCRIPT_DIR}/verify-pack.mjs"

# Only the changelog and the manifests sync-versions.mjs rewrote; anything
# else changed by now is a build writing into the tree, and is refused.
git add --update -- CHANGELOG.md '*package.json'
git diff --quiet || fail "the release left changes outside CHANGELOG.md and the manifests"
git commit --quiet --file - <<EOF
chore(release): ${VERSION} [skip ci]

$(cat "$NOTES_FILE")
EOF
git tag --annotate "$TAG" --message "$TAG"

# --- Push, then publish ----------------------------------------------------

# The checkout persists no credential, so the token is passed for this one
# command. `--atomic`: the commit and the tag land together or not at all.
AUTH="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${AUTH}" \
  push --atomic origin "HEAD:refs/heads/${BRANCH}" "refs/tags/${TAG}"

# pnpm publishes in dependency order — core before SDK, because the SDK pins
# the core at this exact version.
pnpm --filter @stuffs-logger/core --filter @stuffs-logger/sdk publish \
  --access public --provenance --no-git-checks --tag "$DIST_TAG"

PRERELEASE_FLAG="--latest"
if [[ "$DIST_TAG" == "rc" ]]; then
  PRERELEASE_FLAG="--prerelease"
fi
gh release create "$TAG" --verify-tag --title "$TAG" --notes-file "$NOTES_FILE" "$PRERELEASE_FLAG"

echo "release: published ${TAG}"
