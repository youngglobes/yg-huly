# TLS / SSL setup — huly.youngglobe.com

The domain is **proxied through Cloudflare** (orange-cloud). End users get HTTPS at the
Cloudflare edge; the origin needs its own 443 listener so Cloudflare's **Full** SSL mode can
reach it (otherwise HTTPS returns **521 – connection refused**, which is exactly what happened
when CF was set to Full while the origin had only port 80).

## Current state (2026-07-10)
- Origin nginx (`huly_v7-nginx-1`) listens on **80 and 443**. Port 443 uses a **self-signed
  cert** at `ssl/origin.{crt,key}` (server-only, gitignored).
- Cloudflare SSL mode = **Full** (accepts the self-signed origin cert — a self-signed cert
  under *Full (Strict)* would return **526**).
- `compose.yml` publishes 443 and mounts `./ssl:/etc/nginx/ssl:ro`; `.huly.nginx` has
  `listen 443 ssl;` + the `ssl_certificate*` lines in the same server block (all proxy routes
  serve both 80 and 443). `.huly.nginx` and `ssl/` are **server-only** (not in git).

Self-signed cert regeneration:
```bash
cd <DEPLOY_DIR> && mkdir -p ssl
docker run --rm -v "$PWD/ssl:/ssl" alpine/openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 -keyout /ssl/origin.key -out /ssl/origin.crt \
  -subj "/CN=huly.youngglobe.com" -addext "subjectAltName=DNS:huly.youngglobe.com"
docker compose up -d nginx
```

## Planned hardening → Full (Strict) with Let's Encrypt (DNS-01)
Full (non-strict) doesn't *validate* the origin cert, so harden with a CF-trusted cert:
1. Create a **Cloudflare API token** (Zone → DNS → Edit for `youngglobe.com`); put it at
   `<DEPLOY_DIR>/.cloudflare.ini` (gitignored) as `dns_cloudflare_api_token = <token>`.
2. Issue via DNS-01 (works behind the CF proxy; HTTP-01 does not):
   ```bash
   docker run --rm -v /home/developer/letsencrypt:/etc/letsencrypt \
     -v /home/developer/huly-selfhost/.cloudflare.ini:/cf.ini:ro \
     certbot/dns-cloudflare certonly --dns-cloudflare \
     --dns-cloudflare-credentials /cf.ini -d huly.youngglobe.com \
     --non-interactive --agree-tos -m praja@youngglobes.com
   ```
3. Point nginx `ssl_certificate*` at the LE `fullchain.pem`/`privkey.pem` (mount
   `/home/developer/letsencrypt` into the nginx container), `docker compose up -d nginx`.
4. Renew via cron (`certbot renew` + `docker compose exec nginx nginx -s reload`); DNS-01,
   no downtime.
5. In Cloudflare, switch SSL mode to **Full (Strict)**.

## Gotchas (both hit on 2026-07-10)
- **`HOST_ADDRESS` + `SECURE` must match the public URL.** Huly's `config.json` builds
  browser-facing URLs as `http${SECURE:+s}://${HOST_ADDRESS}/...`. With `HOST_ADDRESS=<ip>:80`
  + `SECURE=` empty, the HTTPS page tries to fetch `http://<ip>/_accounts` and `ws://…` →
  browser blocks as **mixed content** → *"Unknown error, failed to fetch"* at login. Fix:
  `HOST_ADDRESS=huly.youngglobe.com`, `SECURE=true` (no `:port`), then recreate services.
  These live in the gitignored `huly_v7.conf` and **survive `down -v`** (config file, not a volume).
- **Restart nginx after recreating app containers.** nginx resolves upstream hostnames
  (`front`, `account`, …) once at startup; if `docker compose up -d` recreates those services
  they get new IPs and nginx serves **502** until `docker compose restart nginx`. A full
  `down -v && up -d` (the re-migration) is fine since everything comes up together.

## Optional hardening
Restrict origin :443 to Cloudflare IP ranges (so the origin can't be hit directly, bypassing
CF) — via the host/Hetzner firewall or an nginx `allow`/`deny` on the Cloudflare ranges.

Quick health checks:
```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/            # origin 443
curl -s  -o /dev/null -w '%{http_code}\n' https://huly.youngglobe.com/  # via Cloudflare
```
