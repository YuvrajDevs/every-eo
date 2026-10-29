#!/usr/bin/env bash
# Prepares a cached WordPress + SQLite copy for the plugin integration tests (no MySQL, no Docker).
# WordPress comes from the @wp-playground/wordpress-builds npm package, so only the npm registry is needed.
set -euo pipefail
CACHE="${WP_TEST_CACHE:-$HOME/.cache/visibility-wp}"
SRC="$CACHE/src"
if [ -f "$SRC/wp-load.php" ]; then echo "$SRC"; exit 0; fi
mkdir -p "$CACHE/npm" "$SRC"
npm install --silent --prefix "$CACHE/npm" @wp-playground/wordpress-builds@0.9.19 >/dev/null
BUILDS="$CACHE/npm/node_modules/@wp-playground/wordpress-builds/src"
unzip -q -o "$BUILDS/wordpress/wp-6.5.zip" -d "$SRC"
unzip -q -o "$BUILDS/sqlite-database-integration/sqlite-database-integration.zip" -d "$SRC/wp-content/plugins/"
rm -rf "$SRC/wp-content/database"
echo "$SRC"
