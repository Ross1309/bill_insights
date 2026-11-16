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
  // Immigration and Defense: chosen 2026-11-15 from the CRS subjects on the 119th's
  // floor/law bills (border security on 33, immigration status 28, citizenship 13,
  // visas 12, asylum 6; intelligence 23, military personnel 19, veterans' pensions 17,
  // defense spending 12). Veterans' *health* stays in Healthcare's watchlist.
  immigration: {
    label: 'Immigration',
    intro: 'What the {congress} Congress has done on immigration: border security, legal status, visas and citizenship, and asylum: what became law, what is moving, and how members voted.',
    policyAreas: ['Immigration'],
    watchlists: {
      border: {
        label: 'Border security',
        subjects: ['Border security and unlawful immigration'],
        titlePattern: '\\bborders?\\b|unlawful immigra|illegal immigra',
        intro: 'Measures CRS tagged Border security and unlawful immigration, or with border or unlawful immigration in the title.',
      },
      'legal-status': {
        label: 'Legal status, visas & citizenship',
        subjects: ['Immigration status and procedures', 'Visas and passports', 'Citizenship and naturalization'],
        titlePattern: '\\bvisas?\\b|citizenship|naturaliz|green card',
        intro: 'Measures CRS tagged Immigration status and procedures, Visas and passports, or Citizenship and naturalization, or with visa, citizenship, naturalization or green card in the title.',
      },
      asylum: {
        label: 'Asylum & refugees',
        subjects: ['Refugees, asylum, displaced persons'],
        titlePattern: '\\basylum\\b|\\brefugees?\\b',
        intro: 'Measures CRS tagged Refugees, asylum, displaced persons, or with asylum or refugee in the title.',
      },
    },
    explainers: ['no-vote', 'resolutions'],
  },
  defense: {
    label: 'Defense',
    intro: 'What the {congress} Congress has done on the military, veterans, defense spending and intelligence: what became law, what is moving, and how members voted.',
    policyAreas: ['Armed Forces and National Security'],
    watchlists: {
      troops: {
        label: 'Troops & military families',
        subjects: ['Military personnel and dependents', 'National Guard and reserves', 'Military medicine', 'Military education and training'],
        titlePattern: 'service ?members?|military (families|spouses|personnel)|national guard|\\btroops\\b',
        intro: 'Measures CRS tagged Military personnel and dependents, National Guard and reserves, Military medicine, or Military education and training, or naming service members, military families, the National Guard or troops in the title.',
      },
      'veterans-benefits': {
        label: "Veterans' benefits",
        subjects: ["Veterans' pensions and compensation", "Veterans' education, employment, rehabilitation", "Veterans' loans, housing, homeless programs"],
        titlePattern: "\\bveterans?'? (benefits|compensation|pensions?|housing|education|employment)",
        intro: "Measures CRS tagged Veterans' pensions and compensation, Veterans' education, employment, rehabilitation, or Veterans' loans, housing, homeless programs, or naming veterans' benefits, compensation, pensions, housing, education or employment in the title. Veterans' health care is in Healthcare.",
      },
      'defense-budget': {
        label: 'Defense budget & weapons',
        subjects: ['Defense spending', 'Military procurement, research, weapons development'],
        titlePattern: 'national defense authorization|defense appropriations|\\bNDAA\\b',
        intro: 'Measures CRS tagged Defense spending or Military procurement, research, weapons development, or naming the National Defense Authorization Act or defense appropriations in the title.',
      },
      intelligence: {
        label: 'Intelligence & surveillance',
        subjects: ['Intelligence activities, surveillance, classified information'],
        titlePattern: '\\bintelligence\\b|surveillance|\\bFISA\\b',
        intro: 'Measures CRS tagged Intelligence activities, surveillance, classified information, or with intelligence, surveillance or FISA in the title.',
      },
    },
    explainers: ['war-powers', 'no-vote', 'resolutions'],
  },
};

// A watchlist measure is "focused" if CRS gave it few subjects or its title names
// the topic; otherwise it's a broad bill (appropriations, defense authorization…)
// that includes the topic among many.
export const FOCUSED_MAX_SUBJECTS = 10;

// Topic + watchlist slugs for one bill, from its policy area and subjects.
// Never in a watchlist: House rules (they only schedule debate on another bill, which
// is listed itself) and impeachment resolutions (CRS tags them with the subjects of the
// charges, so they'd appear under issues like border security, which reads as editorial).
const NOT_IN_WATCHLISTS = /^(providing for consideration of|impeaching)\b/i;

export function topicTags({ policy_area, subjects = [], title = '' }) {
  const tags = [];
  const focus = {};
  const watchable = !NOT_IN_WATCHLISTS.test(String(title).trim());
  for (const [slug, t] of Object.entries(TOPICS)) {
    if (policy_area && t.policyAreas.includes(policy_area)) tags.push(slug);
    if (!watchable) continue;
    for (const [wslug, w] of Object.entries(t.watchlists)) {
      const titled = new RegExp(w.titlePattern, 'i').test(title);
      if (!titled && !w.subjects.some(s => subjects.includes(s))) continue;
      tags.push(wslug);
      focus[wslug] = titled || subjects.length <= FOCUSED_MAX_SUBJECTS;
    }
  }
  return { topics: [...new Set(tags)], topic_focus: focus };
}
