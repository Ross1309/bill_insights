// /sitemap.xml: the path links search engines can index (share.js serves each with its
// own title and description): every stored bill and every current member. Built from
// Firestore (~2,600 reads) at most once a day: the CDN caches it.

import { getDb } from '../lib/firebase.js';

export default async req => {
  const origin = new URL(req.url).origin;
  const db = getDb();
  const [bills, dir] = await Promise.all([
    db.collection('bills').select('update_date').get(),
    db.collection('directory').doc('members').get(),
  ]);
  const url = (path, lastmod) => `<url><loc>${origin}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  const day = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : '');
  const body = [
    url('/'),
    ...(dir.data()?.members || []).map(m => url(`/member/${encodeURIComponent(m.id)}`)),
    ...bills.docs.map(d => url(`/bill/${encodeURIComponent(d.id)}`, day(d.data().update_date))),
  ].join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // ~2,600 reads per build: the cache key ignores query strings, so ?x=… can't force one.
      'Netlify-Vary': 'query=cw-no-param',
      'Cache-Control': 'public, max-age=3600',
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
};

export const config = { path: '/sitemap.xml' };
