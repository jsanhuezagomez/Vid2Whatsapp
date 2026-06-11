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

## MVP Notes

- Static mode extracts one frame and encodes it as a 512x512 WebP.
- Animated mode cuts a short silent clip and encodes it as animated WebP.
- The app asks `yt-dlp` for a direct video stream and lets FFmpeg seek into it.
- Docker, queues, storage, and cloud deployment can be added once the local workflow feels good.
