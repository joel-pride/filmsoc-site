#!/bin/sh
# Container entrypoint: render the vhost (gate on or off), then run Apache.
# Re-runs on every container start/restart.

set -e

TEMPLATE=/etc/apache2/gate-template.conf
VHOST=/etc/apache2/sites-available/000-default.conf
TOKEN_FILE=/var/www/html/.gate-token

# Always re-render from the pristine template so a restart can never leave
# the Apache config out of sync with the token file.
cp "$TEMPLATE" "$VHOST"

if [ "$GATE_ENABLED" = "false" ]; then
	# Launch day: serve the site without a password.
	sed -i '/GATE-BEGIN/,/GATE-END/d' "$VHOST"
else
	# The cookie secret lives in the (bind-mounted) site folder so it
	# survives rebuilds and restarts. Apache checks it in the rewrite
	# rule; gate.php reads the same file to set the cookie.
	if [ ! -s "$TOKEN_FILE" ]; then
		umask 022
		head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"
	fi
	sed -i "s/__GATE_TOKEN__/$(cat "$TOKEN_FILE")/" "$VHOST"
fi

exec apache2-foreground
