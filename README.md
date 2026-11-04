# Inspire Photos — quick prototype

A small React + TypeScript uploader/gallery with a Cloudflare Worker + private R2 bucket backend.

## What works in this prototype

- Public event gallery, sorted by event date (newest first), with a simple search by event title, location, or date.
- Event date is captured during upload so events sort by when they happened, not when the photos were uploaded.
- Individual photo pages (`/p/{id}`) and event share pages (`/e/{id}`).
- Multi-file upload for an administrator, grouped under a named event.
- Browser-side JPEG display-image generation (max 1800px, quality 84%).
- Original file and optimized display copy stored separately in R2.
- Copy-link and WhatsApp-share actions.
- Open Graph image metadata on individual photo pages for WhatsApp previews.

## Important prototype limitations

- Admin authentication is a single shared password configured as a Worker secret. It is suitable for a controlled prototype, not a finished multi-admin identity system.
- The gallery currently lists up to 1,000 photos in one request. Add cursor pagination before a large archive grows beyond that.
- Public links are intentionally unlisted, not private: anyone who obtains a link can view/download that photo. The public gallery lists all uploaded photos.
- This prototype does not include deletion, albums, moderation, malware scanning, or rate limiting.
- R2 bucket must remain private; the Worker serves public read-only image URLs.

## Prerequisites

- Node.js 20+
- A Cloudflare account
- Wrangler login: `npx wrangler login`

## 1. Create the R2 bucket

```bash
npx wrangler r2 bucket create inspire-photos
```

The binding in `wrangler.toml` expects this exact bucket name.

## 2. Configure the admin password

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Enter a strong prototype password when prompted. Do not put this value in source control or frontend `.env` files.

## 3. Run the Worker locally

In one terminal:

```bash
npm install
npm run worker:dev
```

Wrangler will print a local Worker URL, usually `http://localhost:8787`.

## 4. Run the React frontend

In a second terminal, create `.env.local`:

```bash
VITE_API_BASE=http://localhost:8787
```

Then run:

```bash
npm run dev
```

Open the Vite URL shown in the terminal. Go to **Upload photos**, enter the Worker `ADMIN_PASSWORD`, select images, and upload. The gallery will load from the Worker.

## 5. Deploy the Worker

```bash
npm run worker:deploy
```

Set `VITE_API_BASE` to the deployed Worker URL in the frontend environment before building. Deploy the static `dist/` directory to Cloudflare Pages (or use another static host).

## Before inviting the whole group

1. Add pagination and upload rate limits.
2. Replace the shared password with proper named admin accounts.
3. Add file content validation and image decoding safeguards.
4. Decide whether the entire gallery should be public or only individual links should be shareable.
5. Test WhatsApp previews using a deployed HTTPS URL. WhatsApp may cache previews, and local development URLs cannot be previewed by WhatsApp.
6. Add a backup/export policy for the R2 bucket and metadata.


## Viewer and administrator access (v1.1)
The public gallery does not show an Upload tab. The viewer sees a month picker (defaulting to the current month), then the events for that month. For the prototype, open the administrator route `/admin` to reveal the administrator navigation and upload screen, for example `http://localhost:5173/admin`. The earlier `?admin=1` URL remains supported for convenience. Do not share this admin URL with viewers. This query-string switch is only a prototype convenience, not production-grade access control; secure the admin route at the Worker before public deployment.

The display typeface is Cormorant Garamond, selected as a calm, expressive serif inspired by the Google Fonts category link supplied.


## v1.2 interface corrections
The month chooser is implemented as a styled month/year dropdown rather than `input type="month"`, which some browsers render as a plain text field. The public gallery content, month selector, search, and empty state use a centred, constrained layout. The administrator interface is available at `/admin`; the public root URL continues to hide upload controls.


### Share links and local development

The API/Worker origin (`VITE_API_BASE`, typically `http://localhost:8787`) is only for API calls and media delivery. Share links use the frontend origin (`VITE_PUBLIC_BASE_URL`). Leave `VITE_PUBLIC_BASE_URL` empty during local development; links will use the Vite origin (typically `http://localhost:5173`). Event links open the gallery frontend directly at `/e/<event-id>`.

For real sharing with WhatsApp groups or email recipients, deploy the frontend to a publicly reachable HTTPS domain and set `VITE_PUBLIC_BASE_URL` to that domain before building. A `localhost` link is only reachable from the computer running the prototype and will not work for other people.
