#!/usr/bin/env bash
# cf-dns-add.sh — Add a CNAME record in Cloudflare DNS for a Netlify site
#
# Usage:
#   ./scripts/cf-dns-add.sh <subdomain> <netlify-app>
#
# Examples:
#   ./scripts/cf-dns-add.sh myapp myapp-name        # myapp.mdpstudio.com.au → myapp-name.netlify.app
#   ./scripts/cf-dns-add.sh blog cool-blog-abc123    # blog.mdpstudio.com.au → cool-blog-abc123.netlify.app
#
# The script will:
#   1. Check if the record already exists
#   2. If it exists, ask whether to update it
#   3. If not, create a new CNAME record (DNS only / grey cloud)
#
# Requires: curl, jq
# Config:  .env file in project root with CF_API_TOKEN and CF_ZONE_ID

set -euo pipefail

# ── Load .env ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: .env file not found at $ENV_FILE"
    echo "Copy .env.example to .env and fill in your Cloudflare API token."
    exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

# ── Validate config ──────────────────────────────────────────────────────────
: "${CF_API_TOKEN:?Set CF_API_TOKEN in .env (API token with DNS edit permission)}"
: "${CF_ZONE_ID:?Set CF_ZONE_ID in .env (Zone ID from Cloudflare dashboard)}"

DOMAIN="${CF_DOMAIN:-mdpstudio.com.au}"
API="https://api.cloudflare.com/client/v4"

# ── Validate args ────────────────────────────────────────────────────────────
if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <subdomain> <netlify-app-name>"
    echo ""
    echo "  subdomain       The subdomain to create (e.g. 'myapp')"
    echo "  netlify-app     The Netlify app name (e.g. 'cool-blog-abc123')"
    echo ""
    echo "Creates: <subdomain>.${DOMAIN} → <netlify-app>.netlify.app (DNS only)"
    exit 1
fi

SUBDOMAIN="$1"
NETLIFY_APP="$2"
FQDN="${SUBDOMAIN}.${DOMAIN}"
TARGET="${NETLIFY_APP}.netlify.app"

# ── Check dependencies ───────────────────────────────────────────────────────
for cmd in curl jq; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is required but not installed."
        exit 1
    fi
done

# ── Helper: Cloudflare API call ──────────────────────────────────────────────
cf_api() {
    local method="$1" endpoint="$2"
    shift 2
    curl -s -X "$method" \
        "${API}${endpoint}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        "$@"
}

# ── Check if record already exists ───────────────────────────────────────────
echo "Checking if ${FQDN} already exists..."

EXISTING=$(cf_api GET "/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${FQDN}")

if ! echo "$EXISTING" | jq -e '.success' &>/dev/null; then
    echo "ERROR: API call failed."
    echo "$EXISTING" | jq '.errors' 2>/dev/null || echo "$EXISTING"
    exit 1
fi

RECORD_COUNT=$(echo "$EXISTING" | jq '.result | length')

if [[ "$RECORD_COUNT" -gt 0 ]]; then
    EXISTING_TARGET=$(echo "$EXISTING" | jq -r '.result[0].content')
    EXISTING_ID=$(echo "$EXISTING" | jq -r '.result[0].id')
    echo ""
    echo "Record already exists: ${FQDN} → ${EXISTING_TARGET}"
    echo ""

    if [[ "$EXISTING_TARGET" == "$TARGET" ]]; then
        echo "Already pointing to the correct target. Nothing to do."
        exit 0
    fi

    read -rp "Update to ${TARGET}? [y/N] " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi

    # Update existing record
    RESULT=$(cf_api PUT "/zones/${CF_ZONE_ID}/dns_records/${EXISTING_ID}" \
        -d "{\"type\":\"CNAME\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${TARGET}\",\"ttl\":1,\"proxied\":false}")

    if echo "$RESULT" | jq -e '.success' &>/dev/null; then
        echo "Updated: ${FQDN} → ${TARGET} (DNS only)"
    else
        echo "ERROR: Update failed."
        echo "$RESULT" | jq '.errors' 2>/dev/null || echo "$RESULT"
        exit 1
    fi
else
    # Create new record
    echo "Creating CNAME: ${FQDN} → ${TARGET} (DNS only)..."

    RESULT=$(cf_api POST "/zones/${CF_ZONE_ID}/dns_records" \
        -d "{\"type\":\"CNAME\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${TARGET}\",\"ttl\":1,\"proxied\":false}")

    if echo "$RESULT" | jq -e '.success' &>/dev/null; then
        echo ""
        echo "Created: ${FQDN} → ${TARGET} (DNS only)"
        echo ""
        echo "Next: Add custom domain '${FQDN}' in your Netlify site settings."
    else
        echo "ERROR: Creation failed."
        echo "$RESULT" | jq '.errors' 2>/dev/null || echo "$RESULT"
        exit 1
    fi
fi
