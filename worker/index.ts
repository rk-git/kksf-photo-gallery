export interface Env {
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  PUBLIC_BASE_URL?: string;
}

type Meta = {
  id: string;
  caption: string;
  uploadedAt: string;
  contentType: string;
  originalName: string;
  eventId?: string;
  eventTitle?: string;
  eventDate?: string;
};

const ALLOWED_ORIGINS = new Set([
  'https://gallery.alwaysupnetwork.com',
  'http://localhost:5173',
  'http://localhost:8787',
]);

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
  });

  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function json(request: Request, data: unknown, status = 200): Response {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers });
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
}

function isSocialCrawler(request: Request): boolean {
  const ua = request.headers.get('User-Agent') || '';
  return /WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot/i.test(ua);
}

async function allMetadata(bucket: R2Bucket): Promise<Meta[]> {
  const items: Meta[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({
      prefix: 'meta/',
      limit: 1000,
      cursor,
    });

    const pageItems = await Promise.all(
      page.objects.map(async obj => {
        const stored = await bucket.get(obj.key);
        return stored ? stored.json<Meta>() : null;
      })
    );

    items.push(
      ...pageItems.filter((item): item is Meta => item !== null)
    );

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return items;
}

function galleryResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  return env.ASSETS.fetch(new Request(new URL('/', url), request));
}

function sharePage(
  title: string,
  description: string,
  image: string,
  body: string,
): Response {
  const safeTitle = htmlEscape(title);
  const safeDescription = htmlEscape(description);

  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
<meta property="og:type" content="website">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}">
<meta name="twitter:image" content="${image}">
</head>
<body>${body}</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    // API: list photos and events.
    if (
      (path === '/api/photos' || path === '/api/events') &&
      request.method === 'GET'
    ) {
      const items = await allMetadata(env.PHOTOS);
      items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

      const photos = items.map(p => ({
        ...p,
        imageUrl: `${url.origin}/media/${p.id}`,
        originalUrl: `${url.origin}/original/${p.id}`,
        eventId: p.eventId || `legacy-${p.id}`,
        eventTitle: p.eventTitle || 'Earlier shared photographs',
      }));

      if (path === '/api/photos') {
        return json(request, photos);
      }

      const grouped = new Map<string, typeof photos>();

      for (const photo of photos) {
        const group = grouped.get(photo.eventId!) || [];
        group.push(photo);
        grouped.set(photo.eventId!, group);
      }

      const events = [...grouped.entries()].map(([id, group]) => ({
        id,
        title: group[0].eventTitle,
        createdAt: group[group.length - 1].uploadedAt,
        eventDate: group[0].eventDate ||
          group[group.length - 1].uploadedAt.slice(0, 10),
        photoCount: group.length,
        coverUrl: group[0].imageUrl,
        photos: group,
      }));

      events.sort((a, b) =>
        (b.eventDate || b.createdAt.slice(0, 10))
          .localeCompare(a.eventDate || a.createdAt.slice(0, 10))
      );

      return json(request, events);
    }

    // API: verify administrator credentials.
    if (path === '/api/auth' && request.method === 'POST') {
      const origin = request.headers.get('Origin');

      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json(request, { error: 'Origin not allowed' }, 403);
      }

      let body: { password?: string };

      try {
        body = await request.json() as { password?: string };
      } catch {
        return json(request, { error: 'Invalid request' }, 400);
      }

      if (!env.ADMIN_PASSWORD ||
          body.password !== env.ADMIN_PASSWORD) {
        return json(request, { error: 'Invalid administrator password' }, 401);
      }

      return json(request, { authenticated: true });
    }

    // API: authenticated photo upload.
    if (path === '/api/upload' && request.method === 'POST') {
      const origin = request.headers.get('Origin');

      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json(request, { error: 'Origin not allowed' }, 403);
      }

      const auth = request.headers.get('Authorization') || '';

      if (!env.ADMIN_PASSWORD ||
          auth !== `Bearer ${env.ADMIN_PASSWORD}`) {
        return json(request, { error: 'Unauthorized' }, 401);
      }

      const form = await request.formData();
      const original = form.get('original');
      const display = form.get('display');

      if (!(original instanceof File) || !(display instanceof File)) {
        return json(request, {
          error: 'Both original and display images are required.',
        }, 400);
      }

      if (!original.type.startsWith('image/') ||
          !display.type.startsWith('image/')) {
        return json(request, {
          error: 'Only image uploads are accepted.',
        }, 400);
      }

      if (original.size > 20 * 1024 * 1024 ||
          display.size > 8 * 1024 * 1024) {
        return json(request, {
          error: 'Image exceeds the prototype size limit.',
        }, 413);
      }

      const eventId = String(form.get('eventId') || '').slice(0, 64);
      const eventTitle = String(form.get('eventTitle') || '')
        .trim().slice(0, 180);
      const eventDate = String(form.get('eventDate') || '').slice(0, 10);

      if (!eventId || !eventTitle ||
          !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        return json(request, {
          error: 'An event ID, event name and valid event date are required.',
        }, 400);
      }

      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const uploadedAt = new Date().toISOString();
      const caption = String(form.get('caption') || '').slice(0, 500);

      const meta: Meta = {
        id,
        caption,
        uploadedAt,
        contentType: original.type,
        originalName: original.name,
        eventId,
        eventTitle,
        eventDate,
      };

      await Promise.all([
        env.PHOTOS.put(`original/${id}`, original.stream(), {
          httpMetadata: { contentType: original.type },
        }),
        env.PHOTOS.put(`display/${id}.jpg`, display.stream(), {
          httpMetadata: { contentType: 'image/jpeg' },
        }),
        env.PHOTOS.put(`meta/${id}.json`, JSON.stringify(meta), {
          httpMetadata: { contentType: 'application/json' },
        }),
      ]);

      return json(request, {
        ...meta,
        imageUrl: `${url.origin}/media/${id}`,
        originalUrl: `${url.origin}/original/${id}`,
      }, 201);
    }

    // API: authenticated deletion of an individual photo.
    const deleteMatch = path.match(/^\/api\/photos\/([a-zA-Z0-9]{1,64})$/);

    if (deleteMatch && request.method === 'DELETE') {
      const origin = request.headers.get('Origin');

      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json(request, { error: 'Origin not allowed' }, 403);
      }

      const auth = request.headers.get('Authorization') || '';

      if (!env.ADMIN_PASSWORD ||
          auth !== `Bearer ${env.ADMIN_PASSWORD}`) {
        return json(request, { error: 'Unauthorized' }, 401);
      }

      const id = deleteMatch[1];
      const metadata = await env.PHOTOS.get(`meta/${id}.json`);

      if (!metadata) {
        return json(request, { error: 'Photo not found' }, 404);
      }

      await env.PHOTOS.delete([
        `original/${id}`,
        `display/${id}.jpg`,
        `meta/${id}.json`,
      ]);

      return json(request, { success: true, id });
    }

    // Event URL: Open Graph preview for social crawlers;
    // actual React application for human visitors.
    const eventMatch = path.match(/^\/e\/([a-zA-Z0-9]+)$/);

    if (eventMatch && request.method === 'GET') {
      const items = await allMetadata(env.PHOTOS);
      const group = items
        .filter(p => (p.eventId || `legacy-${p.id}`) === eventMatch[1])
        .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

      if (!group.length) {
        return new Response('Event not found', { status: 404 });
      }

      if (!isSocialCrawler(request)) {
        return galleryResponse(request, env);
      }

      const title = group[0].eventTitle || 'Kanchi Mutt Photo Gallery';
      const image = `${url.origin}/media/${group[group.length - 1].id}`;
      const description =
        `${group.length} photographs from this Kanchi Mutt event`;

      return sharePage(
        title,
        description,
        image,
        `<h1>${htmlEscape(title)}</h1>
         <p>${group.length} photographs</p>
         <p><a href="/">Open Kanchi Mutt Photo Gallery</a></p>`,
      );
    }

    // Individual photo sharing page.
    const photoMatch = path.match(/^\/p\/([a-zA-Z0-9]+)$/);

    if (photoMatch && request.method === 'GET') {
      const id = photoMatch[1];
      const object = await env.PHOTOS.get(`meta/${id}.json`);

      if (!object) {
        return new Response('Photo not found', { status: 404 });
      }

      const meta = await object.json<Meta>();
      const image = `${url.origin}/media/${id}`;
      const title = meta.caption || meta.eventTitle ||
        'Kanchi Mutt Photo Gallery';

      if (isSocialCrawler(request)) {
        return sharePage(
          title,
          meta.eventTitle || 'A photograph shared by our community',
          image,
          `<h1>Kanchi Mutt Photo Gallery</h1>
           <p>${htmlEscape(title)}</p>
           <p><a href="/">Open gallery</a></p>`,
        );
      }

      return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<style>
body{font:16px system-ui;background:#f7f5ef;color:#292b27;
max-width:850px;margin:35px auto;padding:0 18px;text-align:center}
img{max-width:100%;max-height:78vh;object-fit:contain;border-radius:12px}
p{color:#666}
a{display:inline-block;margin:14px;padding:12px 18px;
background:#314b3c;color:white;text-decoration:none;border-radius:8px}
</style>
</head>
<body>
<h1>Kanchi Mutt Photo Gallery</h1>
<img src="${image}" alt="${htmlEscape(title)}">
<p>${htmlEscape(title)}</p>
<a href="/original/${id}" download>Download original</a>
<a href="/">Open gallery</a>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Serve display and original images from private R2.
    const mediaMatch = path.match(/^\/(media|original)\/([a-zA-Z0-9]+)$/);

    if (mediaMatch && request.method === 'GET') {
      const key = mediaMatch[1] === 'media'
        ? `display/${mediaMatch[2]}.jpg`
        : `original/${mediaMatch[2]}`;

      const object = await env.PHOTOS.get(key);

      if (!object) {
        return new Response('Not found', { status: 404 });
      }

      const headers = corsHeaders(request);
      object.writeHttpMetadata(headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('ETag', object.httpEtag);

      return new Response(object.body, { headers });
    }

    // All remaining paths are handled by the React static application.
    return env.ASSETS.fetch(request);
  },
};
