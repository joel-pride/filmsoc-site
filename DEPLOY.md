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

Then open `https://filmsoc.yourdomain` — the site should be there, with a
padlock. Check a film page and the admin panel (sign-in now uses your new
strong key).

## 5. Updating the site later

The server *edits* `films.json`, `films.js` and `reviews.json` when you use
the admin panel, so never blindly re-upload those. The safe pattern after
changing code locally is:

```bash
rsync -av --exclude .git --exclude .idea --exclude .DS_Store \
  --exclude films.json --exclude films.js --exclude reviews.json \
  -e "ssh -i $KEY" ./ azureuser@$VM:/srv/web/filmsoc/
```

Containers don't need restarting for PHP/HTML changes — the folder is
bind-mounted, so new files are served immediately.

## 6. Backups

The only irreplaceable data is `filmsoc/reviews.json` (and films.json if
you edit the line-up on the server). Occasionally, from your Mac:

```bash
rsync -av -e "ssh -i $KEY" azureuser@$VM:/srv/web/filmsoc/*.json ./server-backup/
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
