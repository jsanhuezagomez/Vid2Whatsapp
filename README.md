# Vid2WhatsApp

Local-first app for turning a YouTube timestamp into a WhatsApp-style WebP sticker.

## Requirements

- Node.js
- npm
- FFmpeg
- yt-dlp

## Run Locally

```powershell
npm install
npm run dev
```

Open http://localhost:3000.

Generated stickers are written to `tmp/`, which is ignored by Git.

If you do not configure Turnstile keys locally, verification is bypassed in development mode only.

## Security Controls

- Cloudflare Turnstile server-side validation for public deployments.
- Per-IP in-memory rate limiting for `/api/generate`: 3 generations per 10 minutes and 20 per day by default.
- Small in-process job queue with configurable maximum concurrency.
- Strict YouTube URL validation, HTTPS-only links, and playlist parameter stripping.
- Timestamp range and request body size limits.
- Animated clips use a start and end timestamp. Ranges over 5s are rejected.
- FFmpeg runs with `-threads 1` and command timeouts.
- Generated files are capped at 500 KB.
- Old temporary job directories are cleaned automatically.
- Download responses stream files instead of loading them fully into memory.

## Environment

Copy `.env.example` to `.env.local` for local experiments or `.env.production` for Docker:

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
INTERNAL_PROXY_SECRET=
STICKER_MAX_CONCURRENCY=1
STICKER_MAX_QUEUE=4
STICKER_RATE_LIMIT_10M_MAX=3
STICKER_RATE_LIMIT_DAILY_MAX=20
STICKER_TMP_TTL_MS=3600000
```

In production, `TURNSTILE_SECRET_KEY` is required. Without it, `/api/generate` rejects requests.

## Production With Docker

The Docker image includes Node.js, FFmpeg, and yt-dlp. The compose file binds the app only to localhost:

```bash
docker compose up -d --build
docker compose logs -f
```

The app listens on:

```text
127.0.0.1:3001
```

Put Nginx in front of it for `https://sticker.cyberianode.cl`.

Recommended Nginx location for the generate endpoint:

```nginx
limit_req_zone $binary_remote_addr zone=sticker_generate:10m rate=3r/m;

server {
    server_name sticker.cyberianode.cl;

    location /api/generate {
        limit_req zone=sticker_generate burst=3 nodelay;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Sticker-Client-IP $remote_addr;
        proxy_set_header X-Internal-Proxy-Secret "replace-with-a-long-random-secret";
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Sticker-Client-IP $remote_addr;
        proxy_set_header X-Internal-Proxy-Secret "replace-with-a-long-random-secret";
    }
}
```

If the hostname is behind Cloudflare proxy, configure Nginx real IP handling before the `server` block. Trust only Cloudflare IP ranges, then use `CF-Connecting-IP`:

```nginx
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
```

To reject origin requests that do not come from Cloudflare, add the same ranges as `allow` rules in the public `server` block, then deny everything else:

```nginx
allow 103.21.244.0/22;
allow 103.22.200.0/22;
allow 103.31.4.0/22;
allow 104.16.0.0/13;
allow 104.24.0.0/14;
allow 108.162.192.0/18;
allow 131.0.72.0/22;
allow 141.101.64.0/18;
allow 162.158.0.0/15;
allow 172.64.0.0/13;
allow 173.245.48.0/20;
allow 188.114.96.0/20;
allow 190.93.240.0/20;
allow 197.234.240.0/22;
allow 198.41.128.0/17;
allow 2400:cb00::/32;
allow 2606:4700::/32;
allow 2803:f800::/32;
allow 2405:b500::/32;
allow 2405:8100::/32;
allow 2a06:98c0::/29;
allow 2c0f:f248::/32;
deny all;
```

The application intentionally ignores client-sent `X-Forwarded-For`, `X-Real-IP`, and `CF-Connecting-IP`. Rate limits use only `X-Sticker-Client-IP`, which must be overwritten by Nginx.

The app also requires `X-Internal-Proxy-Secret` when `INTERNAL_PROXY_SECRET` is configured. Use the same long random value in `.env.production` and in the Nginx `proxy_set_header` line. This prevents direct requests to the app from forging the trusted internal IP header.

In production, the app rejects requests if `X-Sticker-Client-IP` is missing or invalid. In local development, it falls back to `local-dev` so the UI can run without Nginx.

## Tests

Normal CI tests do not call YouTube or run FFmpeg:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## MVP Notes

- Static mode extracts one frame and encodes it as WebP.
- Animated mode cuts a short silent clip from start timestamp to end timestamp, up to 5 seconds, and encodes it as animated WebP.
- Timestamps must use colon format, such as `1:23` or `1:23.5`; raw seconds like `17.6` are rejected.
- Output can be cropped to square 512x512 or kept in the original aspect ratio, scaled down to fit within 512x512.
- The app asks `yt-dlp` for a direct video stream and lets FFmpeg seek into it.
- Docker, queues, and deployment hardening are included for production use.
