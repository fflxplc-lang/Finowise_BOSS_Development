#!/usr/bin/env bash
# Installs RIA AI's Python engine as a systemd service next to a BOSS copy.
# Run once, as root, on the VPS:
#
#   sudo bash deploy/ria-engine/install-ria-engine.sh finowise-test 8765     # the TEST copy
#   sudo bash deploy/ria-engine/install-ria-engine.sh finowise-b2c 8767      # boss.finowise.com
#
# It needs only python3 (3.8 or newer; standard library — nothing is pip-installed).
# It adds RIA_ENGINE_PORT and a fresh RIA_ENGINE_TOKEN to that user's app.env
# (the Node server reads the same two lines), writes ria-engine-<user>.service,
# starts it, restarts the BOSS service so Node picks up the token, and checks
# both answer. Re-running it is safe: an existing token and port are kept.
set -euo pipefail

U=${1:?usage: install-ria-engine.sh <app user> [port]}
PORT=${2:-8765}
HOME_DIR=/home/$U
APP=$HOME_DIR/app
ENV_FILE=$HOME_DIR/app.env
SVC=ria-engine-$U

command -v python3 >/dev/null || { echo "python3 is not installed: apt-get install -y python3"; exit 1; }
python3 -c 'import sys; assert sys.version_info >= (3, 8), sys.version' || { echo "python3 3.8 or newer is needed"; exit 1; }
[ -d "$APP/ria_engine" ] || { echo "$APP/ria_engine is missing — deploy a BOSS commit that has it first"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE is missing"; exit 1; }

grep -q '^RIA_ENGINE_PORT=' "$ENV_FILE" || echo "RIA_ENGINE_PORT=$PORT" >> "$ENV_FILE"
grep -q '^RIA_ENGINE_TOKEN=' "$ENV_FILE" || echo "RIA_ENGINE_TOKEN=$(openssl rand -hex 32)" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"; chown "$U:$U" "$ENV_FILE"
PORT=$(sed -n 's/^RIA_ENGINE_PORT=//p' "$ENV_FILE")

cat > /etc/systemd/system/$SVC.service <<UNIT
[Unit]
Description=RIA AI Python engine for $U
After=network.target

[Service]
User=$U
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v python3) -m ria_engine.server
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now $SVC
sleep 2
TOKEN=$(sed -n 's/^RIA_ENGINE_TOKEN=//p' "$ENV_FILE")
curl -fs -H "X-Ria-Engine-Token: $TOKEN" "http://127.0.0.1:$PORT/health" >/dev/null && echo "engine: up on 127.0.0.1:$PORT" || { echo "engine did not answer — journalctl -u $SVC -n 50"; exit 1; }

# the BOSS service reads app.env at start: restart it so Node has the token
BOSS_SVC=$( [ "$U" = finowise-test ] && echo finowise-test || ( [ "$U" = finowise ] && echo finowise || echo "$U" ) )
if systemctl list-unit-files | grep -q "^$BOSS_SVC.service"; then systemctl restart "$BOSS_SVC"; echo "restarted $BOSS_SVC"; else echo "restart the BOSS service for $U yourself so it reads RIA_ENGINE_TOKEN"; fi
echo "done. RIA AI uses the engine as soon as /api/ria/engine/health answers for a signed-in user."
