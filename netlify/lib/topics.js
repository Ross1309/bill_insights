// Issue-tracker topic definitions. A bill belongs to a topic by its official CRS
// policy area; to a watchlist if CRS tagged it with one of the watchlist's subject
// terms OR its title names the topic. Every page prints its definition, so editing
// this file is how topics are added or changed.

export const TOPICS = {
  economy: {
    label: 'Economy',
    intro: 'What the {congress} Congress has done on taxes, spending, the financial system, trade and jobs: what became law, what is moving, and how members voted.',
    policyAreas: ['Economics and Public Finance', 'Finance and Financial Sector', 'Taxation', 'Commerce', 'Labor and Employment'],
    // Chosen 2026-11-12 from the CRS subjects on bills that reached the floor (see
    // CLAUDE.md, Issues tab): each catches 16-33 measures, mostly focused ones.
    watchlists: {
      tariffs: {
        label: 'Tariffs & trade',
        subjects: ['Tariffs', 'Trade restrictions', 'Trade agreements and negotiations'],
        titlePattern: '\\btariffs?\\b|\\btrade\\b',
        intro: 'Measures CRS tagged Tariffs, Trade restrictions, or Trade agreements and negotiations, or with tariff or trade in the title.',
      },
      taxes: {
        label: 'Taxes',
        subjects: ['Income tax credits', 'Income tax deductions', 'Income tax rates', 'Income tax exclusion', 'Tax administration and collection, taxpayers'],
        titlePattern: '\\btax(es|ation)?\\b',
        intro: 'Measures CRS tagged with income tax credits, deductions, rates or exclusions, or Tax administration and collection, or with tax in the title.',
      },
      budget: {
        label: 'Budget & debt',
        subjects: ['Budget deficits and national debt', 'Budget process'],
        titlePattern: 'debt limit|debt ceiling|\\bbudget\\b|\\bdeficit',
        intro: 'Measures CRS tagged Budget deficits and national debt or Budget process, or with budget, deficit or debt limit in the title.',
      },
    },
    explainers: ['no-vote', 'resolutions'],
  },
  healthcare: {
    label: 'Healthcare',
    intro: 'What the {congress} Congress has done on health care, Medicare, Medicaid, public health and medical research: what became law, what is moving, and how members voted.',
    policyAreas: ['Health'],
    // Health provisions often ride in bills with another policy area (veterans' care,
    // budget and spending bills), so these watchlists reach beyond the 'Health' area.
    watchlists: {
      coverage: {
        label: 'Coverage & costs',
        subjects: ['Health care coverage and access', 'Health care costs and insurance', 'Medicare', 'Medicaid', 'Prescription drugs'],
        titlePattern: 'medicare|medicaid|health insurance|affordable care|prescription drug|drug pric',
        intro: 'Measures CRS tagged Health care coverage and access, Health care costs and insurance, Medicare, Medicaid or Prescription drugs, or naming one of these in the title.',
      },
      'veterans-health': {
        label: "Veterans' health",
        subjects: ["Veterans' medical care"],
        titlePattern: "veterans'? (health|medical)",
        intro: "Measures CRS tagged Veterans' medical care, or with veterans' health or medical care in the title.",
      },
      'mental-health': {
        label: 'Mental health & substance use',
        subjects: ['Mental health', 'Drug, alcohol, tobacco use'],
        titlePattern: 'mental health|suicide|opioid|substance use|addiction',
        intro: 'Measures CRS tagged Mental health or Drug, alcohol, tobacco use, or with mental health, suicide, opioids, substance use or addiction in the title.',
      },
    },
    explainers: ['no-vote', 'resolutions'],
  },
  'foreign-affairs': {
    label: 'Foreign Affairs',
    intro: 'What the {congress} Congress has done on foreign policy, trade and international aid: what became law, what is moving, and how members voted.',
    policyAreas: ['International Affairs', 'Foreign Trade and International Finance'],
    watchlists: {
      iran: {
        label: 'Iran',
        subjects: ['Iran'],
        titlePattern: 'iran',
        intro: 'Measures CRS tagged Iran, or with Iran in the title.',
      },
      israel: {
        label: 'Israel',
        subjects: ['Israel'],
        titlePattern: 'israel',
        intro: 'Measures CRS tagged Israel, or with Israel in the title.',
      },
      aid: {
        label: 'Foreign aid',
        subjects: ['Foreign aid and international relief', 'Military assistance, sales, and agreements'],
        titlePattern: 'foreign aid|foreign assistance|security assistance|military assistance',
        intro: 'Measures CRS tagged Foreign aid and international relief or Military assistance, sales, and agreements, or with foreign, security or military assistance in the title.',
      },
    },
    explainers: ['war-powers', 'resolutions', 'no-vote'],
  },
};

// A watchlist measure is "focused" if CRS gave it few subjects or its title names
// the topic; otherwise it's a broad bill (appropriations, defense authorization…)
// that includes the topic among many.
export const FOCUSED_MAX_SUBJECTS = 10;

// Topic + watchlist slugs for one bill, from its policy area and subjects.
export function topicTags({ policy_area, subjects = [], title = '' }) {
  const tags = [];
  const focus = {};
  for (const [slug, t] of Object.entries(TOPICS)) {
    if (policy_area && t.policyAreas.includes(policy_area)) tags.push(slug);
    for (const [wslug, w] of Object.entries(t.watchlists)) {
      const titled = new RegExp(w.titlePattern, 'i').test(title);
      if (!titled && !w.subjects.some(s => subjects.includes(s))) continue;
      tags.push(wslug);
      focus[wslug] = titled || subjects.length <= FOCUSED_MAX_SUBJECTS;
    }
  }
  return { topics: [...new Set(tags)], topic_focus: focus };
}
