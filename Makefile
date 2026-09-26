.PHONY: start stop update backup monitor logs ps shell-api shell-db ssl renew-ssl check-personal backup-cron
start:
	bash scripts/start-personal.sh
stop:
	bash scripts/stop-personal.sh
update:
	bash scripts/update-personal.sh
backup:
	bash scripts/backup-personal.sh
monitor:
	bash scripts/monitor-personal.sh
logs:
	bash scripts/personal-compose.sh logs -f --tail=100
ps:
	bash scripts/personal-compose.sh ps -a
shell-api:
	bash scripts/personal-compose.sh exec api-gateway sh
shell-db:
	bash scripts/personal-compose.sh exec postgres sh -c 'exec psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'
ssl:
	bash scripts/ssl-personal.sh issue
renew-ssl:
	bash scripts/ssl-personal.sh renew
check-personal:
	bash scripts/test-personal.sh
backup-cron:
	bash scripts/backup-cron-personal.sh
