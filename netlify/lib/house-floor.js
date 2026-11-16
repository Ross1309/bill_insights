// The House's weekly floor schedule (docs.house.gov, published by the Majority Leader's
// office): what may come up for a vote this week, in three groups. Stored as stats/floor
// for Home's "Coming up in the House". Not every item gets a vote and items are added
// during the week; the nightly run refreshes it. The Senate publishes no comparable list.

import { getText } from './http.js';
import { addDays, easternDate, weekStart } from './vote-stats.js';

const TYPES = new Set(['HR', 'HRES', 'HJRES', 'HCONRES', 'S', 'SRES', 'SJRES', 'SCONRES']);
const KINDS = [
  [/suspension/i, 'suspension'],
  [/pursuant to a rule/i, 'rule'],
];
const decode = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, name) => decode((new RegExp(`\\b${name}="([^"]*)"`).exec(tag) || [])[1] || '');
const text = (xml, tag) => decode(((new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml) || [])[1] || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export const floorUrl = monday => `https://docs.house.gov/billsthisweek/${monday.replace(/-/g, '')}/${monday.replace(/-/g, '')}.xml`;

// Pure: XML -> { week, congress, updated, categories: [{ kind, label, items: [{ label,
// bill_id, text, amended }] }] }. Removed items (remove-date set) are left out.
export function parseFloorSchedule(xml) {
  const root = /<floorschedule\b[^>]*>/.exec(xml || '');
  if (!root) throw new Error('not a floor schedule');
  const congress = Number(attr(root[0], 'congress-num')) || null;
  const categories = [];
  for (const c of xml.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>/g)) {
    const label = attr(c[1], 'type');
    const items = [];
    for (const it of c[2].matchAll(/<floor-item\b([^>]*)>([\s\S]*?)<\/floor-item>/g)) {
      if (attr(it[1], 'remove-date')) continue;
      const num = text(it[2], 'legis-num');
      const m = /^([A-Za-z.\s]+?)\s*(\d+)$/.exec(num);
      const type = m && m[1].replace(/[.\s]/g, '').toUpperCase();
      const raw = text(it[2], 'floor-text');
      const amended = /,?\s*as amended\.?$/i.test(raw);
      items.push({
        label: num.replace(/\s+/g, ' ').trim() || null,
        bill_id: type && TYPES.has(type) && congress ? `${type.toLowerCase()}${m[2]}-${congress}` : null,
        text: raw.replace(/,?\s*as amended\.?$/i, '').trim(),
        amended,
      });
    }
    if (items.length) categories.push({ kind: (KINDS.find(([re]) => re.test(label)) || [null, 'other'])[1], label, items });
  }
  return { week: attr(root[0], 'week-date') || null, congress, updated: attr(root[0], 'update-date') || null, categories };
}

// The week to show: this week (Monday, Eastern) on weekdays; on weekends, next week's if
// it's posted yet, else none (last week's would be stale).
export async function fetchFloorSchedule(now = new Date()) {
  const today = easternDate(now.toISOString());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();   // 0 Sun … 6 Sat
  const monday = dow === 0 || dow === 6 ? addDays(weekStart(today), 7) : weekStart(today);
  const url = floorUrl(monday);
  try {
    const xml = await getText(url, { timeoutMs: 8000, retries: 1 });
    return { ...parseFloorSchedule(xml), status: 'published', source_url: url };
  } catch (err) {
    if (err.status === 404) return { week: monday, status: 'none', categories: [], source_url: url };
    throw err;
  }
}
