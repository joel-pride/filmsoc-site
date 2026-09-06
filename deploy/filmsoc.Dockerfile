# php:8.3-apache ships with curl and mbstring compiled in, which is all
# films.php / reviews.php need — no extensions to install.
FROM php:8.3-apache

# PHP runs as www-data (uid 33 by default). Remap it to uid 1000 — the
# "azureuser" account on the VM — so PHP can write films.json, films.js
# and reviews.json through the bind-mounted site folder.
RUN usermod -u 1000 www-data && groupmod -g 1000 www-data

# Password gate while the site is in development (details in DEPLOY.md):
# Apache bounces cookie-less visitors to gate.php. The entrypoint renders
# the vhost from the template on every start — gate on, or stripped when
# GATE_ENABLED=false (launch day).
#
# headers: the vhost template sets Cache-Control on text assets so
# deployed CSS/JS/HTML changes reach returning visitors.
RUN a2enmod rewrite headers
COPY apache-site-template.conf /etc/apache2/gate-template.conf
COPY gate-entrypoint.sh /usr/local/bin/gate-entrypoint
RUN chmod 0755 /usr/local/bin/gate-entrypoint
ENTRYPOINT ["gate-entrypoint"]
