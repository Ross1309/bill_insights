// "What's in this bill": the structure of a bill's official text (the House/Senate bill
// XML on GovInfo, the same files Congress.gov links) -> its parts (divisions, titles,
// subtitles, ...), each with its heading, its size in words and what it contains
// (sections; in spending bills, the agencies funded). Facts only: nothing here judges
// whether a part belongs in the bill.
//
// Text inside <quoted-block> is wording the bill inserts into other laws: it counts toward
// the size of the part it sits in, but its own sections and titles aren't the bill's.

const STRUCTURE = new Set(['division', 'subdivision', 'title', 'subtitle', 'part', 'subpart', 'chapter', 'subchapter']);
const BODY = new Set(['legis-body', 'resolution-body', 'engrossed-amendment-body']);
const MAX_ITEMS = 2500;        // section / agency headings kept per bill (sizes are always complete)
const MAX_HEADING = 160;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);
const KEEP = /^(U\.S\.|[IVXL]+|[A-Z]{2,5}(?:'S)?|\d.*)$/;   // acronyms, Roman numerals, numbers
const ACRONYMS = new Set(['FDA', 'NASA', 'HUD', 'USDA', 'IRS', 'DHS', 'EPA', 'NIH', 'CDC', 'FBI', 'DOD', 'NSF', 'NOAA', 'FEMA', 'SBA', 'GSA', 'OMB', 'FCC', 'SEC', 'CFTC', 'TSA', 'ICE', 'CBP', 'VA', 'DC', 'US', 'USA', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'CHIPS', 'NDAA', 'COVID']);
// "MILITARY CONSTRUCTION, VETERANS AFFAIRS, AND RELATED AGENCIES" -> "Military Construction,
// Veterans Affairs, and Related Agencies". Headings that already use lower case stay as they
// are, unless `smallCaps`: spending bills' agency and account headings, printed in small caps
// but stored in sentence case ("Bureau of land management", "defense-Wide").
export function tidyHeading(s, { smallCaps = false } = {}) {
  const h = s.replace(/\s+/g, ' ').trim().replace(/[.—–-]+$/, '').trim();
  if (/[a-z]/.test(h) && !smallCaps) return h;
  let first = true;
  return h.split(/([\s—–]+)/).map(w => {
    if (!w || /^[\s—–]+$/.test(w)) return w;
    const isFirst = first; first = false;
    const bare = w.replace(/[^A-Za-z.']/g, '');
    if (ACRONYMS.has(bare.replace(/[.']/g, '')) || (KEEP.test(bare) && ACRONYMS.has(bare))) return w;
    const lower = w.toLowerCase();
    if (!isFirst && SMALL.has(lower.replace(/[^a-z]/g, ''))) return lower;
    return lower.replace(/(^|[-(/"“])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join('');
}

const countWords = s => { const m = s.match(/\S+/g); return m ? m.length : 0; };

// XML string -> { words, sections, official_title, parts: [node], items: [...] }
// node: { kind, enum, heading, words, sections, unheaded, parts: [node], items } where items,
// in document order, are { kind: 'section', enum, heading } (sections with a heading; the
// rest are counted in `unheaded`, e.g. spending bills' numbered general provisions),
// { kind: 'agency', heading, words } (an appropriations heading such as "Department of
// Defense") and { kind: 'account', heading, words } (a funding account under it).
export function billParts(xml) {
  const root = { kind: 'bill', enum: '', heading: '', words: 0, sections: 0, parts: [], items: [] };
  let officialTitle = null;
  const stack = [root];           // structural nodes
  const raw = [];                 // open raw element names
  let inBody = false, quote = 0, items = 0;
  let capture = null;             // { target, field, depth, text }
  let agency = null;              // current appropriations-major heading of the node on top
  let account = null;             // current appropriations-intermediate (funding account)
  let section = null;             // open section (to take its enum + header)

  const re = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, close, name, , selfClose, text] = m;
    if (text !== undefined) {
      if (capture) capture.text += text;
      if (inBody) {
        const n = countWords(decode(text));
        stack.at(-1).words += n;
        if (agency) agency.words += n;
        if (account) account.words += n;
      }
      continue;
    }
    if (!name) continue;
    const tag = name.toLowerCase();
    if (!close) {
      if (selfClose) continue;
      raw.push(tag);
      const depth = raw.length;
      if (tag === 'official-title' && !officialTitle && !inBody) capture = { field: 'official', depth, text: '' };
      if (BODY.has(tag)) inBody = true;
      if (!inBody) continue;
      if (tag === 'quoted-block') quote++;
      if (quote) continue;
      if (STRUCTURE.has(tag)) {
        const node = { kind: tag, enum: '', heading: '', words: 0, sections: 0, parts: [], items: [], depth };
        stack.at(-1).parts.push(node);
        stack.push(node);
        agency = account = null;
      } else if (tag === 'section') {
        account = null;   // general provisions follow the accounts
        section = { kind: 'section', enum: '', heading: '', depth };
        stack.at(-1).sections++;
        if (items < MAX_ITEMS) { stack.at(-1).items.push(section); items++; }
      } else if (tag === 'appropriations-major') {
        agency = { kind: 'agency', heading: '', words: 0, depth };
        account = null;
        if (items < MAX_ITEMS) { stack.at(-1).items.push(agency); items++; }
      } else if (tag === 'appropriations-intermediate') {
        account = { kind: 'account', heading: '', words: 0, depth };
        if (items < MAX_ITEMS) { stack.at(-1).items.push(account); items++; }
      } else if (tag === 'enum' || tag === 'header') {
        // The structural element's (or section's / agency heading's) own enum and header:
        // direct children only, not those of the paragraphs inside it.
        const top = stack.at(-1);
        const owner = [section, account, agency, top].find(o => o?.depth && depth === o.depth + 1) || null;
        const field = tag === 'enum' ? 'enum' : 'heading';
        if (owner && !owner[field] && !(owner.kind !== 'section' && STRUCTURE.has(owner.kind) === false && field === 'enum')) capture = { target: owner, field, depth, text: '' };
      }
      continue;
    }
    // closing tag
    const depth = raw.length;
    if (capture && depth === capture.depth) {
      const value = decode(capture.text).replace(/\s+/g, ' ').trim();
      if (capture.field === 'official') officialTitle = value;
      else capture.target[capture.field] = capture.field === 'heading'
        ? tidyHeading(value, { smallCaps: capture.target.kind === 'agency' || capture.target.kind === 'account' }).slice(0, MAX_HEADING)
        : value.replace(/\.$/, '');
      capture = null;
    }
    raw.pop();
    if (!inBody) continue;
    if (BODY.has(tag)) { inBody = false; continue; }
    if (tag === 'quoted-block') { quote = Math.max(0, quote - 1); continue; }
    if (quote) continue;
    if (STRUCTURE.has(tag) && stack.length > 1 && stack.at(-1).depth === depth) {
      const node = stack.pop();
      const parent = stack.at(-1);
      parent.words += node.words;
      parent.sections += node.sections;
      agency = account = null;   // headings end with the part they're in
    } else if (tag === 'section' && section?.depth === depth) {
      section = null;
    }
  }
  const clean = n => {
    // Spending bills sometimes name a title only by the appropriations heading it opens with
    // (Defense: "Title II" + "OPERATION AND MAINTENANCE"): that heading is the title's name.
    if (!n.heading && n.items[0]?.kind === 'agency' && n.items[0].heading) n.heading = n.items.shift().heading;
    return {
    kind: n.kind, enum: n.enum, heading: n.heading, words: n.words, sections: n.sections,
    unheaded: n.items.filter(it => it.kind === 'section' && !it.heading).length,
    parts: n.parts.map(clean),
    items: n.items.filter(it => it.heading).map(it => (it.kind === 'section'
      ? { kind: 'section', enum: it.enum, heading: it.heading }
      : { kind: it.kind, heading: it.heading, words: it.words })),
    };
  };
  const out = clean(root);
  return { words: out.words, sections: out.sections, official_title: officialTitle, parts: out.parts, items: out.items };
}

// Congress.gov's text versions (newest first) -> { latest, first, count }, each { code, type,
// date }: the code is the version part of the official file name (BILLS-118hr4366enr.xml ->
// "enr"), which bill-parts uses to read that version from GovInfo. Versions without XML
// (the "Public Law" entry, very old bills) are left out.
export function textVersions(list) {
  const withXml = (list || []).map(v => {
    const xml = (v.formats || []).find(f => f.type === 'Formatted XML')?.url || '';
    const code = /BILLS-\d+[a-z]+\d+([a-z]+)\.xml$/.exec(xml)?.[1];
    return code ? { code, type: v.type || null, date: v.date ? v.date.slice(0, 10) : null } : null;
  }).filter(Boolean);
  if (!withXml.length) return null;
  return { latest: withXml[0], first: withXml.at(-1), count: withXml.length };
}
