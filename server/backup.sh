#!/bin/sh
# Root-only consistency backup, briefly pauses Picmake. Does not remove old backups.
set -eu
if [ "$(id -u)" != 0 ]; then
  echo 'Run as root so the backup can pause the service and read private data.' >&2
  exit 1
fi
backup_dir=${1:-/var/backups/picmake}
case "$backup_dir" in /*) ;; *) echo 'Backup directory must be absolute.' >&2; exit 1 ;; esac
case "$backup_dir" in /var/lib/picmake|/var/lib/picmake/*|/opt/picmake|/opt/picmake/*) echo 'Choose a backup directory outside application and data directories.' >&2; exit 1 ;; esac
umask 077
mkdir -p "$backup_dir"
archive="$backup_dir/picmake-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
was_active=false
if systemctl is-active --quiet picmake; then was_active=true; fi
restore_service() {
  if [ "$was_active" = true ]; then systemctl start picmake; fi
}
trap restore_service EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
systemctl stop picmake
tar -C /var/lib -czf "$archive" picmake
tar -tzf "$archive" >/dev/null
printf 'Backup created: %s\n' "$archive"
