# Security

**Read this before you put the tracker anywhere but your own machine.**

## What it is not

**This application has no authentication and no encryption, and was not
designed with either in mind.** There are no accounts, no sessions, no
passwords and no TLS. Every HTTP endpoint is open to anyone who can reach the
port, and all data — including the event log and config — is stored and served
as plain text.

The optional 4-digit profile PINs are not a security control. They only stop
family members from logging entries under each other's names; they do not
protect the API, which will happily answer unauthenticated requests.

That includes `POST /api/restore`, which replaces the entire data set, and
`GET /api/backup`, which hands out every entry and the PIN hashes with it.
Anything that can reach the port can do both.

Deploy it accordingly:

- Put it **behind a reverse proxy** (nginx, Caddy, Traefik) and let the proxy
  terminate TLS and handle any authentication you need — basic auth, an
  identity-aware proxy, mTLS, a VPN, whatever suits you.
- Apply **proper network segmentation**: bind it to a trusted VLAN or a
  WireGuard/Tailscale interface, and use firewall rules so only the proxy can
  reach the app port. Setting `BT_HOST=127.0.0.1` keeps it off the network
  entirely when a proxy is running on the same host.
- **Never expose it directly to the internet**, and don't port-forward to it.

It is a family notebook on a trusted LAN. Treat it as one.

## Profile PINs

Any person can set a 4-digit PIN in **Setup → People → Edit**. Once set, the PIN
is asked for before you can switch to that person, edit their profile, or start
the app as them — so entries don't get logged under the wrong name. An unlock
lasts until the browser tab is closed, and the 🔒 chip at the end of the
people chips re-locks immediately.

PINs are stored as salted scrypt hashes and are never sent to the browser; the
server only answers "yes" or "no", and five wrong guesses trigger a 30-second
lockout. Even so, a four-digit code is a courtesy lock between people who
already trust each other, not a security boundary — see
[what it is not](#what-it-is-not) above.

## A backup is as sensitive as the data folder

A downloaded backup bundle contains the salted PIN hashes along with every
entry. Keep the file as private as `data/` itself. `GET /api/backup` and
`POST /api/restore` are unauthenticated like the rest of the API: anything that
can reach the port can take a full copy of your data, or replace it.

## Putting it behind a proxy

`./scripts/install.sh --system install` writes a hardened unit for you. The one
below is the hand-rolled equivalent, if you would rather own it yourself.

```ini
# /etc/systemd/system/baby-tracker.service
[Unit]
Description=Ultimate Baby Tracker
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/baby-tracker/server.js
Environment=BT_PORT=8477 BT_DATA_DIR=/var/lib/baby-tracker
Restart=always
User=baby

[Install]
WantedBy=multi-user.target
```

Bind to localhost and let a proxy face the network:

```ini
Environment=BT_HOST=127.0.0.1 BT_PORT=8477 BT_DATA_DIR=/var/lib/baby-tracker
```

```nginx
# /etc/nginx/conf.d/baby-tracker.conf
server {
    listen 443 ssl;
    server_name baby.home.lan;

    ssl_certificate     /etc/ssl/certs/home.crt;
    ssl_certificate_key /etc/ssl/private/home.key;

    # Whatever authentication you want, added here rather than in the app.
    auth_basic           "Baby Tracker";
    auth_basic_user_file /etc/nginx/baby.htpasswd;

    # Only the trusted subnet may reach the proxy at all.
    allow 10.10.20.0/24;
    deny  all;

    location / {
        proxy_pass http://127.0.0.1:8477;
        proxy_http_version 1.1;

        # /api/stream is server-sent events: keep it open and unbuffered.
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Reporting something

This is a family notebook, not a product with a security team. If you find
something worth flagging, open an issue on
[the repository](https://github.com/fqazzazee/ultimate-baby-tracker/issues).
