#!/usr/bin/env bash
# Deploy SwapChan to Battleaxe (docker context "battleaxe") behind the Cloudflare tunnel "swapchan". Idempotent.
#   deploy/deploy.sh             build and (re)start api, web, mcp, cloudflared
#   SERVICES="api web" deploy/deploy.sh   a subset
# Secrets come from Vault here and live only in this process's environment; compose hands them to the containers.
#   secret/swapchan/cloudflare  tunnel_token, tunnel_id     (required: written when the tunnel was created)
#   secret/swapchan/fees        recipient, bps, lifi_enabled              (integrator fee; unset = no fee)
#   secret/swapchan/providers   zerox, lifi, relay, velora  (API keys; unset = provider off / free tier)
#   secret/swapchan/reown       project_id                  (wallet connect; unset = connect disabled)
#   secret/swapchan/api         keys                        (SWAPCHAN_API_KEYS; unset = API open)
#   secret/swapchan/mcp         keys                        (MCP_API_KEYS; unset = MCP open, rate-limited)
set -euo pipefail
cd "$(dirname "$0")"
[ "$(docker context show)" = battleaxe ] || { echo "docker context is not battleaxe"; exit 1; }

# The Mac's Vault is plain http on loopback; default it so reads don't silently come back empty.
export VAULT_ADDR=${VAULT_ADDR:-http://127.0.0.1:8200}
need() {  # need <path under secret/swapchan/> <field>: the value, or exit 1 with why
  local v
  v=$(vault kv get -field="$2" "secret/swapchan/$1" 2>/dev/null) && [ -n "$v" ] \
    || { echo "Vault secret/swapchan/$1 $2 is empty or unreadable (VAULT_ADDR=$VAULT_ADDR): not deploying" >&2; return 1; }
  printf %s "$v"
}
opt() { vault kv get -field="$2" "secret/swapchan/$1" 2>/dev/null || true; }

TUNNEL_TOKEN=$(need cloudflare tunnel_token) || exit 1
export TUNNEL_TOKEN
export SWAPCHAN_FEE_RECIPIENT=$(opt fees recipient)
export SWAPCHAN_FEE_BPS=$(opt fees bps)
export SWAPCHAN_LIFI_FEE=$(opt fees lifi_enabled)   # 1 after portal.li.fi has the fee wallet
export ZEROX_API_KEY=$(opt providers zerox)
export LIFI_API_KEY=$(opt providers lifi)
export RELAY_API_KEY=$(opt providers relay)
export VELORA_API_KEY=$(opt providers velora)
export NEXT_PUBLIC_REOWN_PROJECT_ID=$(opt reown project_id)
export SWAPCHAN_API_KEYS=$(opt api keys)
export MCP_API_KEYS=$(opt mcp keys)
if [ -z "$MCP_API_KEYS" ]; then export MCP_ALLOW_ANONYMOUS=1; else export MCP_ALLOW_ANONYMOUS=0; fi

SERVICES=${SERVICES:-api web mcp cloudflared}
docker compose up -d --build $SERVICES
docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
