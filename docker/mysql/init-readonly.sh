#!/bin/sh
set -eu

case "$MYSQL_DATABASE" in
  ''|*[!a-zA-Z0-9_]*) echo 'DB_NAME must contain only letters, numbers, and underscores.' >&2; exit 1 ;;
esac

case "$DB_USER" in
  ''|*[!a-zA-Z0-9_]*) echo 'DB_USER must contain only letters, numbers, and underscores.' >&2; exit 1 ;;
esac

escaped_password=$(printf '%s' "$DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")

mysql --protocol=socket --user=root --password="$MYSQL_ROOT_PASSWORD" <<SQL
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$escaped_password';
GRANT SELECT ON \`$MYSQL_DATABASE\`.* TO '$DB_USER'@'%';
SQL
