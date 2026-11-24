// Where each enacted earmark table is, and how it is checked (scripts/build-earmarks.js).
//
// A fiscal year's earmarks are printed once, as tables at the end of each division's
// explanatory statement in the Congressional Record (GovInfo granule ids below; the enacted
// law's section 4 names the statement it follows). Nothing is published unless every check
// of its table passes:
//   law        the earmark amounts the enacted text itself states for that division, summed
//              (`gap`: a known difference between the printed table and the law, explained in
//              `note`; the table is still shown as printed, with the note)
//   statement  the amounts the explanatory statement gives for "the table entitled 'Community
//              Project Funding/Congressionally Directed Spending'", summed
//   reference  an official count and/or total published elsewhere (CRS, the House Appropriations
//              Committee's copy of the same table), optionally for some rows only (`where`),
//              within `tolerance` dollars when the source rounds
//   parts      other tables in the same statement that split this one up (Financial Services:
//              one table per section of the law) must add up to it exactly
// `title` (the lines above the table) or `header` (its column headings) must match, so a
// changed page can't silently feed another table in. Checked by hand on 2026-11-24; the build
// script re-runs every check each time.

export const EARMARK_SOURCES = {
  2026: [
    {
      key: 'agriculture', subcommittee: 'Agriculture, Rural Development, FDA', bill_id: 'hr5371-119', law: '119-37', division: 'B',
      granule: 'CREC-2025-11-09-pt1-PgS8043-2', table: 0, title: /AGRICULTURE/,
      checks: [
        { kind: 'law', gap: 29, note: "The table's amounts add up to $29 more than the law provides for Distance Learning and Telemedicine projects ($10,767,029 vs $10,767,000); every other account matches the law exactly." },
        { kind: 'reference', count: 746, total: 931e6, tolerance: 0.5e6, source: 'Congressional Research Service, Agriculture and Related Agencies: FY2026 Appropriations (R48564)' },
      ],
    },
    {
      key: 'milcon-va', subcommittee: 'Military Construction, Veterans Affairs', bill_id: 'hr5371-119', law: '119-37', division: 'D',
      granule: 'CREC-2025-11-09-pt1-PgS8043-2', table: 1, title: /MILITARY CONSTRUCTION/,
      checks: [
        { kind: 'reference', count: 126, source: 'Congressional Research Service, FY2026 Military Construction Appropriations: A Summary (IN12622)', note: 'No official total of these projects is published elsewhere: the count matches, and the amounts are as printed (in thousands of dollars).' },
      ],
    },
    {
      key: 'cjs', subcommittee: 'Commerce, Justice, Science', bill_id: 'hr6938-119', law: '119-74', division: 'A',
      granule: 'CREC-2026-01-08-pt3-PgH255', table: 0, title: /COMMERCE, JUSTICE, SCIENCE/,
      checks: [
        { kind: 'law', gap: -1031000, note: 'The law provides $537,978,926 for Byrne Discretionary Community Projects; the printed table lists $536,947,926, which is $1,031,000 less (the House committee\'s own copy of the table has the same total). Every other account matches the law exactly.' },
        { kind: 'reference', count: 1478, total: 1765867704, source: "House Appropriations Committee's copy of the final table (fy26-cjs-1.7.pdf)" },
      ],
    },
    {
      key: 'energy-water', subcommittee: 'Energy and Water Development', bill_id: 'hr6938-119', law: '119-74', division: 'B',
      granule: 'CREC-2026-01-08-pt3-PgH255', table: 1, header: /Budget[\s\S]*Additional/, amountHeading: 'Additional',
      amountNote: 'Army Corps and Reclamation projects: the amount added to the President\'s budget request (the table\'s "Additional Amount" column).',
      checks: [
        { kind: 'reference', where: { agency: /Engineers/ }, count: 219, total: 1.827e9, tolerance: 0.5e6, source: 'Congressional Research Service, Energy and Water Development: FY2026 Appropriations (R48599)' },
        { kind: 'reference', where: { agency: /Reclamation/ }, count: 13, total: 124e6, tolerance: 0.5e6, source: 'Congressional Research Service (R48599)' },
        { kind: 'reference', where: { agency: /Energy/ }, total: 97557000, source: 'Public Law 119-74, Division B (Energy Projects account)' },
      ],
    },
    {
      key: 'interior', subcommittee: 'Interior, Environment', bill_id: 'hr6938-119', law: '119-74', division: 'C',
      granule: 'CREC-2026-01-08-pt3-PgH255', table: 2, title: /INTERIOR/,
      checks: [
        { kind: 'reference', count: 1277, total: 1743889899, source: "House Appropriations Committee's copy of the final table (fy26-interior-1.7.pdf)" },
      ],
    },
    {
      key: 'labor-hhs', subcommittee: 'Labor, Health and Human Services, Education', bill_id: 'hr7148-119', law: '119-75', division: 'B',
      granule: 'CREC-2026-01-22-pt2-PgH1353-2', table: 0, title: /LABOR, HEALTH/,
      checks: [{ kind: 'statement' }],
    },
    {
      key: 'thud', subcommittee: 'Transportation, Housing and Urban Development', bill_id: 'hr7148-119', law: '119-75', division: 'D',
      granule: 'CREC-2026-01-22-pt2-PgH1353-2', table: 2, title: /COMMUNITY PROJECT FUNDING/,
      checks: [{ kind: 'law' }, { kind: 'statement' }],
    },
    {
      key: 'fsgg', subcommittee: 'Financial Services and General Government', bill_id: 'hr7148-119', law: '119-75', division: 'E',
      granule: 'CREC-2026-01-14-pt1-PgH811', table: 4, header: /Requestor/,
      checks: [{ kind: 'parts', tables: [0, 1, 2, 3], note: 'The four tables for sections 204, 527, 530 and 542 of the law' }],
    },
    {
      key: 'homeland', subcommittee: 'Homeland Security', bill_id: 'hr7147-119', law: '119-86', division: 'A',
      // Printed with the January package; H.R. 7147's section 4 adopts that statement.
      granule: 'CREC-2026-01-22-pt2-PgH1353-2', table: 1, title: /HOMELAND SECURITY/,
      checks: [{ kind: 'law' }],
    },
  ],
};
