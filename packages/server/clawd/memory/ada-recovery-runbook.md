# Ada Resilience Runbook

## Quick Reference

| Component | Location | Purpose |
|-----------|----------|---------|
| **Watchdog cron** | ada-gateway crontab (every 5min) | Auto-restart if gateway dies |
| **Recovery scripts** | Scotty: `~/clawd/skills/ada-recovery/scripts/` | Remote recovery from Pi |
| **Local watchdog** | ada-gateway: `~/clawd/scripts/ada-watchdog.sh` | On-machine health monitor |
| **Config backups** | ada-gateway: `~/.clawdbot/clawdbot.json.bak*` | Rollback targets |

## Symptoms & Actions

### Ada not responding
1. Run health check from Scotty: `~/clawd/skills/ada-recovery/scripts/health-check.sh`
2. If down (exit 2): `~/clawd/skills/ada-recovery/scripts/restart-gateway.sh`
3. Watchdog should auto-recover within 5 minutes

### Config error kills gateway
1. `~/clawd/skills/ada-recovery/scripts/fix-config.sh` (rollback to last backup)
2. Then: `~/clawd/skills/ada-recovery/scripts/restart-gateway.sh`

### Zombie processes blocking restart
The restart script handles this automatically:
- Kills defunct processes
- Kills stale cron/update processes  
- Kills remaining gateway
- Waits for clean state
- Starts fresh

## Safety Limits
- **Max 3 auto-restarts per hour** (prevents restart loops)
- Config backups preserved with timestamps
- All actions logged to `/tmp/ada-watchdog.log` and `/tmp/ada-recovery.log`

## PHASE 2 (Next Steps)
- [ ] Spin up backup VM in different GCP zone (~$10/month)
- [ ] Daily config sync via cron
- [ ] Test failover procedure

## PHASE 3 (Future)
- [ ] Cross-agent monitoring (Spock→Ada→Scotty→Spock)
- [ ] Automated forensics on crash
