# php:8.3-apache ships with curl and mbstring compiled in, which is all
# films.php / reviews.php need — no extensions to install.
FROM php:8.3-apache

# PHP runs as www-data (uid 33 by default). Remap it to uid 1000 — the
# "azureuser" account on the VM — so PHP can write films.json, films.js
# and reviews.json through the bind-mounted site folder.
RUN usermod -u 1000 www-data && groupmod -g 1000 www-data
