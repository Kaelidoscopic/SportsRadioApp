# Pi Update Workflow

Use this workflow after Codex commits and pushes changes to GitHub.

## One-Time Pi Folder Setup

The Pi project folder should be a git clone of the repository, not a directory of copied server files.

```bash
sudo systemctl stop sports-sync-pi.service
mv /home/kael/sports-sync-pi /home/kael/sports-sync-pi.backup
git clone https://github.com/Kaelidoscopic/SportsRadioApp.git /home/kael/sports-sync-pi
cp /home/kael/sports-sync-pi.backup/.env /home/kael/sports-sync-pi/.env
cp /home/kael/sports-sync-pi.backup/appliance-config.json /home/kael/sports-sync-pi/appliance-config.json 2>/dev/null || true
cd /home/kael/sports-sync-pi
npm install --omit=dev --prefix server
```

The systemd service should run from the repo's `server` folder:

```ini
[Service]
WorkingDirectory=/home/kael/sports-sync-pi/server
ExecStart=/usr/bin/npm run pi-host
Restart=always
RestartSec=5
EnvironmentFile=/home/kael/sports-sync-pi/.env
User=kael
```

After editing the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sports-sync-pi.service
sudo systemctl start sports-sync-pi.service
```

## Normal Update Flow

1. Codex makes changes locally.
2. Codex commits and pushes to GitHub.
3. SSH into the Pi:

```bash
ssh kael@sportsyncpi.local
```

4. Make the updater executable once:

```bash
cd /home/kael/sports-sync-pi
chmod +x scripts/update-pi.sh
```

5. Run the updater after future pushes:

```bash
cd /home/kael/sports-sync-pi
./scripts/update-pi.sh
```

The script will:

- cd `/home/kael/sports-sync-pi`
- pull `origin main`
- install server dependencies from `/home/kael/sports-sync-pi/server`
- restart `sports-sync-pi`
- show service status
- print the log command to run next

## Logs

Watch runtime logs with:

```bash
sudo journalctl -u sports-sync-pi -f
```

Expected update result:

- git pull completes
- npm install completes
- systemd restarts the service
- Pi logs show the configured appliance id, room code, room name, and audio device detection

## If `git pull` Asks For A GitHub Token

If the repo is private or GitHub prompts for credentials, use one of these options:

- Use a GitHub personal access token when prompted for the password.
- Configure SSH deploy-key access and change the Pi remote to SSH:

```bash
cd /home/kael/sports-sync-pi
git remote set-url origin git@github.com:Kaelidoscopic/SportsRadioApp.git
```

- If the repo is public, make sure the remote is HTTPS and does not include stale credentials:

```bash
cd /home/kael/sports-sync-pi
git remote set-url origin https://github.com/Kaelidoscopic/SportsRadioApp.git
```

After fixing credentials, rerun:

```bash
./scripts/update-pi.sh
```
