#!/bin/sh
set -eu

validate_identifier() {
  case "$2" in
    ''|*[!a-zA-Z0-9_]*) echo "$1 must contain only letters, numbers, and underscores." >&2; exit 1 ;;
  esac
}

validate_identifier MYSQL_DATABASE "${MYSQL_DATABASE:-}"
validate_identifier DB_USER "${DB_USER:-}"
validate_identifier NOTIFICATION_DB_USER "${NOTIFICATION_DB_USER:-}"

if [ "$NOTIFICATION_DB_USER" = "$DB_USER" ] || [ "$NOTIFICATION_DB_USER" = root ]; then
  echo 'Notification writer must be a separate non-root user.' >&2
  exit 1
fi

case "${NOTIFICATION_DB_PASSWORD:-}" in
  ''|*[!a-zA-Z0-9]*) echo 'NOTIFICATION_DB_PASSWORD must be a nonempty alphanumeric secret.' >&2; exit 1 ;;
esac

mysql --protocol=socket --user=root --password="$MYSQL_ROOT_PASSWORD" <<SQL
CREATE TABLE IF NOT EXISTS \`$MYSQL_DATABASE\`.\`notification_log\` (
  \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`notification_key\` VARCHAR(191) NOT NULL,
  \`type\` VARCHAR(20) NOT NULL,
  \`source_id\` INT NOT NULL,
  \`status\` VARCHAR(20) NOT NULL,
  \`reason\` VARCHAR(100) NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`notification_log_key_unique\` (\`notification_key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE USER IF NOT EXISTS '$NOTIFICATION_DB_USER'@'%' IDENTIFIED BY '$NOTIFICATION_DB_PASSWORD';
ALTER USER '$NOTIFICATION_DB_USER'@'%' IDENTIFIED BY '$NOTIFICATION_DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$MYSQL_DATABASE\`.\`notification_log\` TO '$NOTIFICATION_DB_USER'@'%';
SQL
