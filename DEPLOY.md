# Putting the site live

The plan: one Azure VM runs Docker. Caddy (a small web server) handles
HTTPS and routes subdomains to projects. The filmsoc site runs as the
first project. Everything is free until the Azure student credit runs
out (it renews yearly while you're a verified student).

On the server the files land like this:

```
/srv/web/
  compose.yaml        ← from deploy/
  Caddyfile           ← from deploy/  (edit: your real domain)
  filmsoc.Dockerfile  ← from deploy/
  filmsoc/            ← the site itself (index.html, films.php, ...)
```

## 1. Create the VM (Azure portal, ~10 min)

1. [portal.azure.com](https://portal.azure.com) → search **Virtual machines** → **Create → Azure virtual machine**.
2. **Basics**
   - Subscription: *Azure for Students* · Resource group: create `web`
   - VM name: `web` · Region: any *Recommended* European one (student
     subscriptions only allow a subset of regions — Denmark East etc. is fine)
   - Image: **Ubuntu Server 24.04 LTS - x64 Gen2**
   - Size: **Standard_B1s** (1 vCPU, 1 GB RAM — use "See all sizes" if it's not shown)
   - Administrator account: **SSH key** · username `azureuser` · key pair name `web-vm`
3. **Inbound ports**: tick **SSH (22), HTTP (80), HTTPS (443)** — all three.
4. Review + create → Create. A **Download private key** button appears —
   save `web-vm.pem` somewhere sensible (`~/.ssh/web-vm.pem`) and don't lose it.
5. When deployment finishes, open the VM's page and copy its **Public IP address**.

Cost sanity check: B1s + public IP + disk burns roughly $10–12/month of the
$100 credit. Check the **Cost Management** blade occasionally. The credit
renews each year you re-verify as a student.

## 2. Point the domain at the VM (Name.com)

1. Name.com → My domains → your domain → **DNS Records**.
2. Add record: type **A**, host `filmsoc`, answer `<the public IP>`, TTL default.
3. Optional but nice: a second A record, host `@` (the bare domain), same IP.

DNS can take from seconds to a few hours to propagate. `ping filmsoc.yourdomain`
should eventually resolve to the VM's IP.

## 3. Prepare the server (one-time)

From your Mac (chmod the key once — SSH refuses world-readable keys):

```bash
chmod 400 ~/.ssh/web-vm.pem
ssh -i ~/.ssh/web-vm.pem azureuser@<VM_IP>

# now on the server:
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit   # group changes need a fresh login
```

## 4. Upload the site and start it

Back on your Mac, in the filmsoc-site repo folder. **First** make sure
`config.php` has a strong `ADMIN_KEY` (a long random string — this is what
protects the admin panel once it's on the public internet). Then:

```bash
VM=<VM_IP>
KEY=~/.ssh/web-vm.pem

# the site (config.php rides along; .git and editor noise stay home)
rsync -av --exclude .git --exclude .idea --exclude .DS_Store \
  -e "ssh -i $KEY" ./ azureuser@$VM:/tmp/site-upload/

# the three deploy files
rsync -av -e "ssh -i $KEY" deploy/ azureuser@$VM:/tmp/site-upload-deploy/

# lay them out as /srv/web and start everything
ssh -i $KEY azureuser@$VM
sudo mkdir -p /srv/web/filmsoc && sudo chown -R $USER:$USER /srv/web
mv /tmp/site-upload-deploy/* /srv/web/
mv /tmp/site-upload/* /srv/web/filmsoc/
rm -rf /tmp/site-upload /tmp/site-upload-deploy   # catches dotfiles mv * misses
cd /srv/web
nano Caddyfile        # replace yourdomain.example with your real domain
docker compose up -d --build
docker compose logs -f caddy   # watch "certificate obtained" — Ctrl-C to exit
```

Then open `https://filmsoc.yourdomain` — you should land on the password
gate (see §6); type the `GATE_PASSWORD` from `config.php` and you're
through to the site, with a padlock. Check a film page and the admin panel
(sign-in now uses your new strong key).

## 5. Updating the site later

Everything here runs **on the Mac**, from the repo folder — rsync connects
to the server itself, and the one command that must run on the VM (the
rebuild) is wrapped in `ssh` below. Shell variables don't survive a new
terminal window, so start every session with:

```bash
cd ~/Documents/joel_projects/filmsoc-site
VM=9.205.17.16        # the VM's public IP (Azure portal → VM → Overview)
KEY=~/.ssh/web-vm.pem
```

There are two kinds of change, with different procedures:

- **Site content** — HTML/CSS/JS/PHP pages, images. The site folder is
  bind-mounted into the container, so an rsync makes these live
  instantly. No rebuild, no restart needed.
- **Deploy files** — anything in `deploy/` (Dockerfile, compose.yaml,
  gate template/entrypoint, Caddyfile). These are baked into the image,
  so they need the second rsync **plus** a rebuild (step 3).

### Step 1 — back up the server's live data

The admin panel and reviews.php write `films.json`, `films.js` and
`reviews.json` *on the server* — those copies are the live ones, and step
2's excludes exist to protect them. Snapshot them before anything that
could touch them:

```bash
rsync -av -e "ssh -i $KEY" "azureuser@$VM:/srv/web/filmsoc/*.json" ./server-backup/   # quotes stop zsh expanding the * locally
rsync -av -e "ssh -i $KEY" azureuser@$VM:/srv/web/filmsoc/films.js ./server-backup/
```

### Step 2 — upload the site (every content change)

```bash
rsync -av --delete \
  --exclude .git --exclude .idea --exclude .DS_Store --exclude server-backup \
  --exclude films.json --exclude films.js --exclude reviews.json \
  --exclude .gate-token \
  --exclude deploy --exclude DEPLOY.md \
  -e "ssh -i $KEY" ./ azureuser@$VM:/srv/web/filmsoc/
```

What the excludes protect:

- `films.json` / `films.js` / `reviews.json` — server-owned data. **Change
  the line-up through admin.html, never by hand-editing these locally**:
  films.php regenerates them on every admin save and would overwrite hand
  edits. If you ever must push a local copy, do it as a deliberate
  one-file upload (`rsync -av -e "ssh -i $KEY" ./films.js azureuser@$VM:/srv/web/filmsoc/`)
  after step 1's backup.
- `.gate-token` — the gate's cookie secret; replacing it logs every
  visitor out.
- `deploy/` and `DEPLOY.md` — server internals, not web pages. Uploading
  them publishes them at `https://…/deploy/…` to anyone past the gate
  (this actually happened on 6 Sep 2026 — if those URLs ever work again,
  `ssh -i $KEY azureuser@$VM "rm -rf /srv/web/filmsoc/deploy /srv/web/filmsoc/DEPLOY.md"`).
- `config.php` is *not* excluded on purpose: it rides along, which is how
  ADMIN_KEY / GATE_PASSWORD changes roll out (effective immediately).

`--delete` makes the server an exact mirror of the repo: pages removed or
renamed locally disappear on the server too. Excluded files are never
deleted by it. Add `-n` (dry run) first if you want a preview of what
would be sent and deleted.

### Step 3 — upload deploy files and rebuild (only if you touched deploy/)

**Exclude Caddyfile** — the server's copy has your real domain in it; the
repo copy is just the template:

```bash
rsync -av --exclude Caddyfile -e "ssh -i $KEY" deploy/ azureuser@$VM:/srv/web/
ssh -i $KEY azureuser@$VM "cd /srv/web && docker compose up -d --build"
```

How to know it worked: the `COPY …` build steps run fresh (not `CACHED`)
and compose reports `Container web-filmsoc-1 Recreated` (not `Running`).
If everything says `CACHED` and the container's status is still "Up N
days", nothing changed — usually step 3's rsync was skipped or the files
never differed.

### Step 4 — check the live site

The vhost serves `.css`/`.js`/`.html` with `Cache-Control: no-cache`, so
an ordinary reload always revalidates and picks up deploys. If a page
still looks old, don't redeploy — first check whether the *server* is new
and only your browser is stale:

```bash
JAR=$(mktemp)
curl -s -c "$JAR" -o /dev/null -d "password=THE_GATE_PASSWORD" 'https://filmsoc.jbps.app/gate.php?to=/'
curl -s -b "$JAR" https://filmsoc.jbps.app/styles.css | shasum   # compare: shasum styles.css
```

Matching checksums → it's your browser: hard-refresh once (Cmd+Shift+R)
and move on. (Only files cached before 6 Sep 2026 — before the no-cache
header existed — can ever be stale.) Mismatched → re-run step 2 and read
rsync's output: it lists exactly which files transferred.

### Update troubleshooting

- **zsh: no matches found** — an unquoted `*` in a remote path; zsh tries
  to expand it locally. Quote the whole `azureuser@…` path.
- **rsync succeeded but the site looks unchanged** — do step 4 before
  anything else; nine times out of ten the server is fine and the browser
  cache is lying.
- **Build all CACHED / container "Up N days"** — the deploy files never
  changed on the server; check you actually ran step 3's first command.
- **Bounced back to the gate after a rebuild** — `docker compose restart
  filmsoc` re-syncs the token with Apache (details in §6).
- **Line-up edits vanished after an upload** — films.php rewrites
  films.json/films.js from the admin panel's saves; restore from
  ./server-backup/ and use admin.html next time.

## 6. The password gate (while the site is in development)

Until the site is ready to launch, every visitor first hits a dark
"Coming soon" page (`gate.php`) that matches the site's look and asks for
a password. Share that password with whoever should get a peek.

- **The password** is `GATE_PASSWORD` in `config.php`. Change it locally
  and upload with step 5's rsync — new logins use it immediately, though
  people already in stay in (their cookie is checked against a server
  secret, not the password).
- **Staying logged in** is a cookie that lasts 30 days.
- **Kicking everyone out** (password leaked, or you just want a clean
  slate) — regenerate the secret, which invalidates every cookie out
  there:

  ```bash
  rm /srv/web/filmsoc/.gate-token && docker compose restart filmsoc
  ```

- **On launch day**: set `GATE_ENABLED: "false"` in `/srv/web/compose.yaml`
  and run `docker compose up -d` on the server. The gate rules vanish and
  `gate.php` itself just forwards to the home page — nothing to un-deploy.

The gate is enforced by Apache inside the filmsoc container (rendered from
`deploy/apache-site-template.conf` by `deploy/gate-entrypoint.sh` on every
container start), so it covers every page, image and endpoint — not just
the HTML. If logging in ever loops straight back to the gate, `docker
compose restart filmsoc` re-syncs things; check `docker compose logs
filmsoc` if it doesn't.

## 7. Backups

The only irreplaceable data is `filmsoc/reviews.json` (and films.json if
you edit the line-up on the server). Occasionally, from your Mac:

```bash
rsync -av -e "ssh -i $KEY" "azureuser@$VM:/srv/web/filmsoc/*.json" ./server-backup/   # quotes stop zsh expanding the * locally
rsync -av -e "ssh -i $KEY" azureuser@$VM:/srv/web/filmsoc/films.js ./server-backup/
```

Or snapshot the VM's disk from the Azure portal (Settings → Disks →
+ Create snapshot).

## Troubleshooting

- **Can't SSH** — VM Overview → Networking → check port 22 inbound rule exists.
- **No certificate / browser warning** — `docker compose logs caddy` on the
  server. Usually the DNS record hasn't propagated, or the Caddyfile still
  says `yourdomain.example`. Caddy retries automatically.
- **502 from the site** — the filmsoc container is down: `docker compose ps`,
  `docker compose logs filmsoc`.
- **"reviews.json is not writable" errors** — `ls -l /srv/web/filmsoc` should
  show your user (uid 1000) as owner; the container's PHP runs as the same
  uid, so this "just works" — if you changed anything about users, re-check.
