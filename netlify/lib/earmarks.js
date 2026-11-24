// Enacted earmarks ("Community Project Funding" in the House, "Congressionally Directed
// Spending" in the Senate) from the explanatory statements printed in the Congressional
// Record (GovInfo HTML). Each statement ends a bill's division with a fixed-width table:
//
//   ----------------------------------------------------------------------
//                                                        Requestor(s)
//    Agency   Account   Recipient   Project   Location   Amount  ---------------  Origination
//                                                                House   Senate
//   ----------------------------------------------------------------------
//   DOC      NIST--STR  Johnson C.  Johnson C. Smith     Charlotte, 1,031,000  Adams  .....  H
//             S          Smith ...   University: ...      NC
//   ----------------------------------------------------------------------
//
// Rows sit between dashed lines, cells wrap inside their columns, and the columns differ by
// bill. A table is only trusted when its rows add up to the amounts the statement itself gives
// for "the table entitled 'Community Project Funding/Congressionally Directed Spending'"
// (`statedTotals`): scripts/build-earmarks.js publishes nothing that doesn't reconcile.

const DASH = /^-{40,}\s*$/;

export function recordLines(html) {
  const text = html.replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()];
    });
  return text.split('\n').map(l => l.replace(/\s+$/, ''));
}

// Senate tables pad cells with leader dots ("3,100,000......", "Boozman..."): same-width spaces
// keep the columns where they are.
const undot = l => l.replace(/\.{2,}/g, m => ' '.repeat(m.length));
const skip = l => !l.trim() || /^\[\[Page [A-Z]?\d+\]\]/.test(l.trim()) || /^\s*\[(GRAPHIC|TIFF)/.test(l);
// A table row starts at the left margin and has column gaps; prose after a table is indented
// or runs on without gaps. (The amount may not be on the first line: narrow columns wrap
// "11,000,000" as "11,000,00" + "0".)
const rowStart = l => /^\S/.test(l) && /\S {2,}\S/.test(l);

// Lines -> [{ title: [lines above], header: [lines], rows: [[lines]], start, end }]
export function findTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!DASH.test(lines[i])) continue;
    const look = lines.slice(i + 1, i + 5).join(' ');
    if (!/Request(o|e)r/i.test(look)) continue;
    let j = i + 1;
    const header = [];
    while (j < lines.length && !DASH.test(lines[j])) header.push(undot(lines[j++]));
    const rows = [];
    let block = [];
    for (j++; j < lines.length; j++) {
      const l = undot(lines[j]);
      if (DASH.test(l)) {
        if (block.length) { rows.push(block); block = []; }
        continue;
      }
      if (skip(l)) continue;
      if (!block.length && !rowStart(l)) break;      // first line after a separator isn't a row: the table is over
      block.push(l);
    }
    if (block.length && rowStart(block[0])) rows.push(block);
    const title = [];
    for (let k = i - 1; k >= 0 && title.length < 3; k--) {
      if (!lines[k].trim()) { if (title.length) break; continue; }
      if (/^\s{8,}\S/.test(lines[k])) title.unshift(lines[k].trim()); else break;
    }
    tables.push({ title, header, rows, start: i, end: j });
    i = j - 1;
  }
  return tables;
}

// Column boundaries: character positions blank in (nearly) every row line. `tolerance` lets a
// few overhanging words through; those words are kept whole when the cells are cut (`cut`).
export function columnSpans(lines, tolerance = 0.985) {
  if (!lines.length) return [];
  const width = Math.max(...lines.map(l => l.length));
  const blank = new Array(width).fill(0);
  for (const l of lines) for (let p = 0; p < width; p++) if ((l[p] || ' ') === ' ') blank[p]++;
  const spans = [];
  let start = null;
  for (let p = 0; p <= width; p++) {
    const isBlank = p === width || blank[p] >= tolerance * lines.length;
    if (!isBlank && start === null) start = p;
    if (isBlank && start !== null) { spans.push([start, p]); start = null; }
  }
  return spans;
}

// One line -> its text per column, keeping words whole: a word crossing a boundary goes to
// the column holding most of it.
export function cut(line, spans) {
  const out = spans.map(() => []);
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    const a = m.index, b = a + m[0].length;
    let best = -1, bestOverlap = 0;
    spans.forEach(([s, e], k) => {
      const o = Math.min(b, e) - Math.max(a, s);
      if (o > bestOverlap) { bestOverlap = o; best = k; }
    });
    if (best < 0) {   // in a gutter: the nearest column
      best = spans.reduce((bi, [s, e], k) => (Math.abs((s + e) / 2 - a) < Math.abs((spans[bi][0] + spans[bi][1]) / 2 - a) ? k : bi), 0);
    }
    out[best].push(m[0]);
  }
  return out.map(ws => ws.join(' '));
}

// Parts of one cell (one per line) -> its text. A part whose line reaches the column's right
// edge may have been cut by the width: the next line then continues the same word
// ("Transportati" + "on", "NIST--STR" + "S"), unless the piece before is a word seen whole
// elsewhere in the table (`whole`: "Hospital" + "and" stays two words). Also "word- word" ->
// "word-word", the Record's "--" for an em dash, and the trailing period of the Senate's dots.
function joinCell(parts, edges, whole = new Set()) {
  let out = '';
  parts.forEach((t, i) => {
    if (!t) return;
    const last = /(\S+)$/.exec(out)?.[1] || '';
    const broken = edges[i - 1] && /[A-Za-z]$/.test(out) && (/^[a-z]/.test(t) || /^[A-Z]{1,2}\b/.test(t)) && !whole.has(last.toLowerCase());
    const glue = !out ? '' : broken ? '' : ' ';
    out += glue + t;
  });
  return out.replace(/(\w)- (\w)/g, '$1-$2').replace(/--/g, '—').replace(/\s+/g, ' ').trim().replace(/(\w)-$/, '$1')
    .replace(/(?<!\b(?:Inc|Co|Corp|Ltd|St|Jr|Sr|U\.S|D\.C|No))\.$/, '');
}
// A requester cell -> names. Narrow columns wrap names mid-word ("Hickenloope" + "r", "Warr" +
// "en": a lowercase fragment continues the word before it), and the Record's typesetting
// leaves a "P" for some spaces ("Markey,PWarr en", "BluntPRochester").
export const names = s => s
  .replace(/(^|[a-z,\s])P\s?(?=[A-Z])/g, '$1 ')
  .replace(/([A-Za-z]) ([a-z])/g, '$1$2')
  .split(/,\s*/).map(x => x.replace(/\.{2,}/g, '').replace(/\.$/, '').trim()).filter(Boolean);
const STATE_NAMES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'American Samoa': 'AS', Guam: 'GU', 'Northern Mariana Islands': 'MP', 'Puerto Rico': 'PR', 'Virgin Islands': 'VI', 'U.S. Virgin Islands': 'VI' };
const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '));

// A money cell: "1,031,000", "$2,140,000", or wrapped across lines ("11,000,00" + "0").
const money = cell => {
  const t = cell.replace(/[\s$`'"]/g, '');
  return /^\d{1,3}(,\d{3})*$/.test(t) ? Number(t.replace(/,/g, '')) : null;
};
const isMoneyish = cell => /^\$?[\d,\s`]+(\s[A-Z].*)?$/.test(cell) && /\d,\d/.test(cell);

// A table -> { columns: [header text per column], roles, rows: [{ agency, account, recipient,
// project, location, state, amount, house: [last names], senate: [last names], requesters
// (a single combined column), origination }], unread: [rows without a readable amount] }
// `amountHeading`: which money column is the earmark when there are several (Energy and
// Water: budget request, additional amount, total); the build script picks it per table.
export function parseTable(table, { amountHeading = null } = {}) {
  const lines = table.rows.flat();
  let spans = columnSpans(lines);
  const headings = sp => {
    const head = sp.map(() => []);
    for (const h of table.header) cut(h, sp).forEach((w, k) => { if (w) head[k].push(w); });
    return head.map(ws => ws.join(' ').replace(/-{2,}/g, ' ').replace(/\s+/g, ' ').trim());
  };
  // A column without a heading is part of a neighbor: most lines are continuation lines with
  // only the project text, so a one-space gap inside "Bureau of Indian Affairs" or "Federal
  // Assistance-" looks like a gutter. It goes back into the nearer neighbor with a heading.
  for (let changed = true; changed;) {
    changed = false;
    const cols = headings(spans);
    const k = cols.findIndex((h, i) => !h && cols.some(x => x) && (cols[i - 1] || cols[i + 1]));
    if (k < 0) break;
    const left = k > 0 && cols[k - 1] ? spans[k][0] - spans[k - 1][1] : Infinity;
    const right = k < spans.length - 1 && cols[k + 1] ? spans[k + 1][0] - spans[k][1] : Infinity;
    const j = left <= right ? k - 1 : k + 1;
    const merged = [Math.min(spans[j][0], spans[k][0]), Math.max(spans[j][1], spans[k][1])];
    spans = spans.filter((_, i) => i !== j && i !== k);
    spans.push(merged);
    spans.sort((x, y) => x[0] - y[0]);
    changed = true;
  }
  const columns = headings(spans);
  // Words seen whole: every word of a cell's line except its last (which may be cut short).
  const whole = new Set();
  for (const l of lines) for (const part of cut(l, spans)) for (const w of part.split(' ').slice(0, -1)) whole.add(w.toLowerCase());
  const cells = table.rows.map(block => {
    // Each cell from the parts of the block's lines under its column (a word overhanging a
    // gutter is kept whole, in the column holding most of it).
    const per = block.map(l => cut(l, spans));
    return spans.map((sp, k) => joinCell(per.map(p => p[k]), block.map(l => /\S/.test(l[sp[1] - 1] || '')), whole));
  });
  // Money columns: most cells are amounts. The earmark is the one named `amountHeading`, else
  // the last money column (total / amount provided).
  const moneyCols = spans.map((_, k) => k).filter(k => cells.filter(c => isMoneyish(c[k])).length > 0.6 * cells.length);
  const named = amountHeading && moneyCols.find(k => new RegExp(amountHeading, 'i').test(columns[k]));
  const amountCol = named ?? moneyCols.at(-1) ?? -1;
  const role = { amount: amountCol };
  columns.forEach((h, k) => {
    if (moneyCols.includes(k)) return;
    if (k > amountCol && /\bHouse\b/.test(h) && role.house === undefined) role.house = k;
    else if (k > amountCol && /\bSenate\b/.test(h) && role.senate === undefined) role.senate = k;
    else if (k > amountCol && /Origination/i.test(h)) role.origination = k;
    else if (k > amountCol && /Request(o|e)r/i.test(h) && role.requesters === undefined) role.requesters = k;
    else if (k > amountCol && cells.every(c => /^[HSP]?$/.test(c[k]))) role.origination = k;
    else if (k < amountCol && (/^State\b/i.test(h) || cells.filter(c => STATES.has(c[k]) || STATE_NAMES[c[k]]).length > 0.9 * cells.length)) role.state = k;
    else if (k < amountCol && /Location/i.test(h)) role.location = k;
    else if (k < amountCol && /Recipient/i.test(h) && /Project/i.test(h)) role.project = k;   // "Project Name; Recipient"
    else if (k < amountCol && /Recipient/i.test(h)) role.recipient = k;
    else if (k < amountCol && /Project/i.test(h)) role.project = k;
    else if (k < amountCol && /Account/i.test(h)) role.account = k;
    else if (k < amountCol && /Agency/i.test(h)) role.agency = k;
  });
  // The House requesters printed inside the amount column ("Amount ($) House"): the amount is
  // split off each cell below, and the rest is the House's.
  if (role.house === undefined && /\bHouse\b/.test(columns[amountCol] || '')) role.house = -1;
  // Two requester columns without "House"/"Senate" words in their own cells (the words sit
  // under a shared "Requestor(s)" heading): the first is the House's.
  if (role.requesters !== undefined && role.house === undefined && role.senate === undefined) {
    const next = role.requesters + 1;
    if (next < spans.length && role.origination !== next && !moneyCols.includes(next) && /House|Senate/.test(table.header.join(' '))) {
      role.house = role.requesters; role.senate = next; delete role.requesters;
    }
  }
  // "[Dollars in thousands]" above the table (the Senate's Military Construction table).
  const scale = /dollars in thousands/i.test(table.title.join(' ')) ? 1000 : 1;
  const rows = [], unread = [], warnings = [];
  for (let c of cells) {
    // A row printed one column to the left (one Homeland Security row: its project and
    // recipient run together): put the cells back under their headings.
    if (amountCol > 1 && money(c[amountCol]) === null && money(c[amountCol - 1]) !== null) {
      c = [...c.slice(0, amountCol - 2), '', ...c.slice(amountCol - 2)].slice(0, spans.length);
      warnings.push(`realigned: ${c.slice(0, 3).join(' | ').slice(0, 80)}`);
    }
    // The amount column running into the House requesters' ("3,000,000 Landsman").
    if (amountCol >= 0) {
      const m = /^(\$?[\d,\s`]+?)\s+([A-Z].*)$/.exec(c[amountCol]);
      if (m && money(m[1]) !== null) {
        c = [...c];
        c[amountCol] = m[1];
        if (role.house === -1) c.house = m[2];
        else if (role.house !== undefined) c[role.house] = [m[2], c[role.house]].filter(Boolean).join(', ');
      }
    }
    const amount = amountCol >= 0 ? money(c[amountCol]) : null;
    if (amount === null) { unread.push(c.join(' | ').slice(0, 200)); continue; }
    const get = r => (role[r] !== undefined && role[r] >= 0 ? c[role[r]] : r === 'house' && role.house === -1 ? c.house || '' : '');
    const location = get('location');
    const project = get('project');
    const stateCell = get('state');
    // State: its own column, else the end of the location ("Charlotte, NC"), else the ", XX,"
    // in a project description ("Alaska Primary Care Association, AK, to establish ...").
    const state = STATE_NAMES[stateCell] || (STATES.has(stateCell) ? stateCell : null)
      || /,\s*([A-Z]{2})$/.exec(location)?.[1] || /,\s([A-Z]{2})(?=[,;\s]|$)/.exec(project)?.[1] || null;
    rows.push({
      agency: get('agency'), account: get('account'), recipient: get('recipient'), project, location,
      state: STATES.has(state) ? state : null, amount: amount * scale,
      house: names(get('house')), senate: names(get('senate')), requesters: names(get('requesters')),
      origination: get('origination') || null,
    });
  }
  return { columns, roles: role, rows, unread, warnings, money_columns: moneyCols.map(k => columns[k]) };
}

// The amounts the statement gives for "the table entitled 'Community Project Funding/
// Congressionally Directed Spending'" in a stretch of text (one per account), e.g.
//   "The agreement includes $95,501,000 for the projects, and in the amounts, specified in the table"
//   "$9,647,000 is for the purposes and amounts specified in the table entitled ``Community..."
export function statedTotals(text) {
  const flat = text.replace(/\s+/g, ' ');
  const out = [];
  const re = /\$([\d,]+)(?:(?!\$)[^;]){0,220}?\btable (?:entitled|titled),?\s*(?:``|"|“)?\s*(?:Community Project Funding|Congressionally Directed Spending)/gi;
  const seen = new Set();
  let m;
  while ((m = re.exec(flat))) { seen.add(m.index); out.push(Number(m[1].replace(/,/g, ''))); }
  // "The agreement includes $95,501,000 for the projects, and in the amounts, specified in the
  // table titled ..." (a page marker can split the table's name, so the phrase is enough).
  const re2 = /agreement includes \$([\d,]+) for the projects,? and in the amounts/gi;
  while ((m = re2.exec(flat))) if (![...seen].some(i => Math.abs(i - m.index) < 40)) out.push(Number(m[1].replace(/,/g, '')));
  return out;
}

// --- Checks ---------------------------------------------------------------------------

// The enacted text of one division (bill XML from GovInfo), as plain text.
export function lawDivisionText(xml, division) {
  const re = /<division\b[^>]*>\s*<enum>([A-Z]+)<\/enum>([\s\S]*?)(?=<division\b[^>]*>\s*<enum>|<\/legis-body>)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] === division) return m[2].replace(/<[^>]+>/g, ' ').replace(/&#x2014;/g, '—').replace(/\s+/g, ' ');
  }
  return '';
}

// The earmark amounts a law's text states ("$57,650,000 shall be for the purposes, and in the
// amounts, specified for this account in the table titled Community Project Funding/...").
export function lawAmounts(text) {
  const out = [];
  const re = /\$([\d,]+)(?:(?!\$)[^;]){0,320}?(Community Project Funding|Congressionally Directed Spending|Incorporation of Community Project)/g;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[1].replace(/,/g, '')));
  return out;
}

const sumOf = rows => rows.reduce((a, r) => a + r.amount, 0);
const fmt = n => `$${Math.round(n).toLocaleString('en-US')}`;

// One configured check (netlify/lib/earmark-sources.js) -> { kind, ok, detail, source, note }.
// ctx: { lawText, statementText, parts: [parsed tables] }
export function runCheck(check, rows, ctx = {}) {
  const base = { kind: check.kind, source: check.source || null, note: check.note || null };
  if (check.kind === 'law') {
    const amounts = lawAmounts(ctx.lawText || '');
    const law = amounts.reduce((a, b) => a + b, 0), table = sumOf(rows);
    const ok = amounts.length > 0 && table - law === (check.gap || 0);
    return { ...base, ok, detail: `table ${fmt(table)}, law ${fmt(law)} (${amounts.length} amounts)${check.gap ? `, known difference ${fmt(check.gap)}` : ''}` };
  }
  if (check.kind === 'statement') {
    const stated = statedTotals(ctx.statementText || '');
    const want = stated.reduce((a, b) => a + b, 0), table = sumOf(rows);
    return { ...base, ok: stated.length > 0 && want === table, detail: `table ${fmt(table)}, statement ${fmt(want)} (${stated.length} amounts)` };
  }
  if (check.kind === 'reference') {
    const subset = check.where ? rows.filter(r => Object.entries(check.where).every(([k, re]) => re.test(r[k] || ''))) : rows;
    const countOk = check.count === undefined || subset.length === check.count;
    const totalOk = check.total === undefined || Math.abs(sumOf(subset) - check.total) <= (check.tolerance || 0);
    return { ...base, ok: countOk && totalOk, detail: `${subset.length} projects, ${fmt(sumOf(subset))}; reference ${check.count ?? '-'} projects, ${check.total !== undefined ? fmt(check.total) : '-'}${check.tolerance ? ` (±${fmt(check.tolerance)})` : ''}` };
  }
  if (check.kind === 'parts') {
    const partRows = (ctx.parts || []).flatMap(p => p.rows);
    const ok = partRows.length === rows.length && sumOf(partRows) === sumOf(rows);
    return { ...base, ok, detail: `table ${rows.length} projects ${fmt(sumOf(rows))}; parts ${partRows.length} projects ${fmt(sumOf(partRows))}` };
  }
  return { ...base, ok: false, detail: `unknown check ${check.kind}` };
}

// --- Requesters -> members ------------------------------------------------------------

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ').trim();

// congress-legislators people (current + historical) -> lookup by (last name, state, chamber),
// for the members who served at some point from the start of that Congress (January 3 of an
// odd year) to `date`, the day the table was printed: a member who requested projects and then
// left still counts; someone who left before that Congress, or a senator appointed months
// later, doesn't. `index.firsts`: bioguide -> first names, to tell apart two members with the
// same last name and state ("Scott, David").
export function congressStart(date) {
  const y = Number(date.slice(0, 4));
  const odd = y % 2 ? y : y - 1;
  return `${date < `${odd}-01-03` ? odd - 2 : odd}-01-03`;
}
export function memberIndex(people, date) {
  const from = congressStart(date);
  const index = new Map();
  index.firsts = new Map();
  for (const p of people) {
    for (const t of p.terms || []) {
      if (!(t.start <= date && t.end > from)) continue;
      index.firsts.set(p.id.bioguide, new Set([p.name?.first, p.name?.nickname, (p.name?.official_full || '').split(' ')[0]].filter(Boolean).map(fold)));
      const chamber = t.type === 'sen' ? 'senate' : 'house';
      // "Hernández Rivera" is printed "Hernandez": the first and last words of a compound last
      // name, and the last word of the official name, all count.
      const last = p.name?.last || '';
      const lasts = new Set([last, last.split(' ')[0], last.split(' ').at(-1), (p.name?.official_full || '').split(' ').at(-1)].filter(Boolean).map(fold));
      lasts.add(`*|${chamber}`);
      for (const last of lasts) {
        if (last.startsWith('*|')) continue;
        for (const key of [`${last}|${t.state}|${chamber}`, `${last}|*|${chamber}`]) {
          if (!index.has(key)) index.set(key, new Set());
          index.get(key).add(p.id.bioguide);
        }
      }
    }
  }
  return index;
}

// "Joyce (OH)" -> { name: "Joyce", state: "OH" }
function requesterName(raw) {
  const m = /^(.*?)\s*\(([A-Z]{2})\)\s*$/.exec(raw.trim());
  return { name: (m ? m[1] : raw).trim(), state: m ? m[2] : null };
}

// One requester name -> { id, name } (id null unless exactly one member matches). The
// project's state first; else, when the name is unique in that chamber nationwide (a Virginia
// senator's project in DC), that member.
export function matchRequester(raw, rowState, chamber, index) {
  const { name, state } = requesterName(raw);
  const chambers = chamber ? [chamber] : ['senate', 'house'];
  const lookup = st => {
    const hits = new Set();
    for (const ch of chambers) for (const id of index.get(`${fold(name)}|${st}|${ch}`) || []) hits.add(id);
    return hits;
  };
  let hits = lookup(state || rowState);
  if (!hits.size && !state) hits = lookup('*');
  return { id: hits.size === 1 ? [...hits][0] : null, name: state ? `${name} (${state})` : name, candidates: [...hits] };
}

// A requester list -> matches, joining "Gonzales, Tony (TX)" (last name, first name) into one
// requester when the last name matches on its own and the "first name" doesn't.
export function matchRequesters(list, rowState, chamber, index) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const m = matchRequester(list[i], rowState, chamber, index);
    const next = list[i + 1];
    const firstName = next && /^[A-Z][a-z]+(?: [A-Z]\.)?(?: \(([A-Z]{2})\))?$/.exec(next);
    if (firstName && !matchRequester(next, rowState, chamber, index).id) {
      const withState = matchRequester(firstName[1] ? `${list[i]} (${firstName[1]})` : list[i], rowState, chamber, index);
      const first = fold(next.replace(/\s*\(.*$/, '').split(' ')[0]);
      const byFirst = withState.candidates.filter(id => index.firsts?.get(id)?.has(first));
      const id = withState.id || (byFirst.length === 1 ? byFirst[0] : null);
      if (id) { out.push({ id, name: `${list[i]}, ${next}`, candidates: [id] }); i++; continue; }
    }
    out.push(m);
  }
  return out;
}

// --- Storage shapes -------------------------------------------------------------------

// Rows -> the compact public table doc: accounts listed once, rows as arrays, requesters as
// bioguide ids or "~Name" when unmatched.
export function packRows(rows) {
  const accounts = [], accountIndex = new Map();
  const ref = r => {
    const key = `${r.agency}|${r.account}`;
    if (!accountIndex.has(key)) { accountIndex.set(key, accounts.length); accounts.push([r.agency, r.account]); }
    return accountIndex.get(key);
  };
  const who = list => list.map(x => x.id || `~${x.name}`);
  return {
    accounts,
    rows: rows.map(r => [ref(r), r.recipient, r.project, r.location, r.state, r.amount, who(r.houseMatched || []), who(r.senateMatched || []), r.origination || '']),
  };
}
