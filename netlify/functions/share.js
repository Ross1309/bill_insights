// Shareable, previewable links: /bill/<id>, /member/<bioguideId>, /vote/<vote id>.
// The site is one page with #routes, and nothing after "#" reaches a server, so link
// previews (iMessage, Slack, social sites) and search engines only ever saw the home page.
// These paths serve the same page with that item's own title, description and preview
// tags (from Firestore); in the browser the app opens the item as usual (router.js turns
// the path into its #route). Cached at the CDN for a day.

import { getDb } from '../lib/firebase.js';
import { officialLabel, escapeHtml as esc, ordinal, STATE_NAMES } from '../../public/util.js';
import { voteHeadline, resultWord, outcomeOf } from '../../public/plain.js';
import { stageSteps } from '../../public/stage.js';
import { missedVotes } from '../../public/participation.js';

const SITE = 'Congress Watcher';
const PARTY = { Democratic: 'D', Republican: 'R', Independent: 'I' };
let shell = null;   // index.html, fetched once per warm instance

const clip = (s, n = 200) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const pct = x => `${x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)}%`;

async function billMeta(db, id) {
  const b = (await db.collection('bills').doc(id).get()).data();
  const label = officialLabel(b?.bill_number || id);
  if (!b) return { title: `${label} — ${SITE}`, description: `Status, official summary, actions and roll-call votes for ${label}, from Congress.gov.` };
  const status = stageSteps(b)?.status;
  const bullet = b.ai_summary?.bullet_points?.[0];
  return {
    title: `${label}: ${clip(b.title || '', 110)} — ${SITE}`,
    description: clip([status && `${status}.`, bullet || (b.crs_summary_available === false ? 'No official summary published yet.' : '')].filter(Boolean).join(' ')
      || `Status, actions and votes for ${label}.`),
  };
}

async function memberMeta(db, id) {
  const [m, rec, part] = await Promise.all([
    db.collection('members').doc(id).get().then(s => s.data()),
    db.collection('member_votes').doc(id).get().then(s => s.data()),
    db.collection('stats').doc('participation').get().then(s => s.data()),
  ]);
  if (!m) return null;
  const name = String(m.name || '').split(', ').reverse().join(' ');
  const place = STATE_NAMES[m.state] || m.state || '';
  const seat = m.chamber === 'Senate' ? `${m.state}` : `${m.state}-${m.district || 'AL'}`;
  const role = m.chamber === 'Senate' ? `Senator from ${place}` : m.district ? `Representative for ${place}'s ${ordinal(m.district)} district` : `Member of the House for ${place}`;
  const x = m.current !== false && rec?.congress === part?.congress ? missedVotes({ ...m, id }, part, rec?.totals) : null;
  const votes = x?.delegate ? 'Delegates may vote only on some amendments.'
    : x ? `Missed ${x.missed} of ${x.votes} roll-call votes this Congress (${pct(x.share)}${x.median != null ? `; typical ${x.chamber} member ${pct(x.median)}` : ''}).` : '';
  return {
    title: `${name} (${PARTY[m.party] || ''}-${seat}) — ${SITE}`,
    description: clip(`${role}${m.current === false ? ' (no longer serving)' : ''}. ${votes} Voting record, sponsored bills and campaign finance.`.replace(/\s+/g, ' ')),
  };
}

async function voteMeta(db, id) {
  const v = (await db.collection('vote_summaries').doc(id).get()).data();
  if (!v) return null;
  const item = { chamber: v.chamber, question: v.question, outcome: outcomeOf(v.result), document_title: v.document_title,
    bill: v.bill_id ? { id: v.bill_id, label: v.legislation || v.bill_id, title: v.bill_title || null } : null };
  const p = v.party_breakdown || {};
  const parties = ['D', 'R'].filter(k => p[k]).map(k => `${k === 'D' ? 'Democrats' : 'Republicans'} ${p[k].yea}–${p[k].nay}`).join(', ');
  const date = v.date ? new Date(v.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '';
  return {
    title: `${clip(voteHeadline(item), 120)} — ${SITE}`,
    description: clip(`${resultWord(item)} ${v.tallies?.yea ?? '?'}–${v.tallies?.nay ?? '?'}${date ? ` on ${date}` : ''}. ${parties ? `${parties}. ` : ''}${v.question || ''}. How each member voted, from the official record.`),
  };
}

const KINDS = { bill: billMeta, member: memberMeta, vote: voteMeta };
const VALID = { bill: /^[a-z]+\d+-\d+$/, member: /^[A-Z]\d{6}$/, vote: /^\d+-\d-(house|senate)-vote-\d+$/ };

// Replace the shell's title/description and add canonical + preview tags.
export function withMeta(html, { title, description, url, image }) {
  const tags = [
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
  ].join('\n  ');
  return html
    // The shell's own (home page) preview tags give way to this item's.
    .replace(/\s*<!-- Link previews[^>]*-->/, '')
    .replace(/\s*<(link rel="canonical"|meta property="og:|meta name="twitter:)[^>]*>(<meta property="og:[^>]*>)?/g, '')
    // Replacer functions: "$&" etc. in a title must stay literal text.
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, () => `<meta name="description" content="${esc(description)}" />\n  ${tags}`);
}

export default async req => {
  const url = new URL(req.url);
  // A query string would make every request a CDN miss (and Firestore reads): send it to
  // the clean URL instead, before reading anything.
  if (url.search) return new Response(null, { status: 301, headers: { Location: url.pathname, 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=86400' } });
  const [, kind, raw] = url.pathname.split('/');
  const id = decodeURIComponent(raw || '');
  if (!KINDS[kind] || !VALID[kind].test(id)) return new Response('Not found', { status: 404 });
  shell ??= await fetch(new URL('/index.html', url)).then(r => (r.ok ? r.text() : Promise.reject(new Error(`index.html ${r.status}`))));
  let meta = null;
  try { meta = await KINDS[kind](getDb(), id); } catch (err) { console.error(`${kind} ${id}:`, err.message); }
  const found = Boolean(meta);
  meta ||= { title: SITE, description: 'Non-partisan tracking of what the US Congress is doing, in plain language from official sources.' };
  const html = withMeta(shell, { ...meta, url: `${url.origin}/${kind}/${encodeURIComponent(id)}`, image: `${url.origin}/og.png` });
  return new Response(html, {
    status: found ? 200 : 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Netlify-CDN-Cache-Control': found ? 'public, durable, s-maxage=86400, stale-while-revalidate=604800' : 'public, durable, s-maxage=3600',
    },
  });
};

export const config = { path: ['/bill/*', '/member/*', '/vote/*'] };
