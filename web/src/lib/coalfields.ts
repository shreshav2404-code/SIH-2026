/**
 * India's major coalfields, as points on a real map.
 *
 * WHY THIS EXISTS AS DATA. The obvious way to show "coal mines of India" is to
 * paste a picture of a map, and the three candidates for that were a Chegg
 * graphic, a watermarked study-notes JPEG and a Shutterstock preview - none of
 * them ours to ship. Coordinates are facts and cannot be owned, so the same
 * information is rendered on OpenStreetMap tiles instead: licence-clean,
 * zoomable, and it can carry this project's own data on top.
 *
 * ACCURACY. Each point is the approximate CENTRE of a coalfield, not a mine
 * head and not a lease boundary. A coalfield spans tens of kilometres; these
 * are good enough to show distribution and completely wrong for anything
 * operational. The only surveyed geometry in this system is the lease polygon
 * held in PostGIS, which is what every compliance check actually uses.
 *
 * Sources are public: Ministry of Coal and Coal India subsidiary descriptions
 * of the major fields. Reserves figures are deliberately omitted - they move,
 * they are disputed, and nothing here needs them.
 */

export type CoalType = "coking" | "non-coking" | "lignite";

export interface Coalfield {
  name: string;
  state: string;
  /** The Coal India subsidiary, or the operator where it is not CIL. */
  operator: string;
  type: CoalType;
  lat: number;
  lon: number;
  /** True for the field this deployment's demo mine sits in. */
  demo?: boolean;
}

export const COALFIELDS: Coalfield[] = [
  // ---- Eastern coking belt -------------------------------------------
  {
    name: "Jharia",
    state: "Jharkhand",
    operator: "BCCL",
    type: "coking",
    lat: 23.75,
    lon: 86.42,
  },
  {
    name: "East Bokaro",
    state: "Jharkhand",
    operator: "CCL",
    type: "coking",
    lat: 23.78,
    lon: 85.95,
  },
  {
    name: "West Bokaro",
    state: "Jharkhand",
    operator: "CCL",
    type: "coking",
    lat: 23.75,
    lon: 85.65,
  },
  {
    name: "North Karanpura",
    state: "Jharkhand",
    operator: "CCL",
    type: "non-coking",
    lat: 23.75,
    lon: 84.95,
  },
  {
    name: "Raniganj",
    state: "West Bengal",
    operator: "ECL",
    type: "non-coking",
    lat: 23.62,
    lon: 87.13,
  },

  // ---- Central ---------------------------------------------------------
  {
    name: "Korba",
    state: "Chhattisgarh",
    operator: "SECL",
    type: "non-coking",
    lat: 22.35,
    lon: 82.68,
    demo: true,
  },
  {
    name: "Singrauli",
    state: "Madhya Pradesh",
    operator: "NCL",
    type: "non-coking",
    lat: 24.1,
    lon: 82.67,
  },
  {
    name: "Sohagpur",
    state: "Madhya Pradesh",
    operator: "SECL",
    type: "non-coking",
    lat: 23.2,
    lon: 81.35,
  },
  {
    name: "Pench-Kanhan",
    state: "Madhya Pradesh",
    operator: "WCL",
    type: "non-coking",
    lat: 22.05,
    lon: 78.95,
  },

  // ---- Eastern seaboard -------------------------------------------------
  {
    name: "Talcher",
    state: "Odisha",
    operator: "MCL",
    type: "non-coking",
    lat: 20.95,
    lon: 85.13,
  },
  {
    name: "Ib Valley",
    state: "Odisha",
    operator: "MCL",
    type: "non-coking",
    lat: 21.85,
    lon: 83.9,
  },

  // ---- Western / southern ----------------------------------------------
  {
    name: "Wardha Valley",
    state: "Maharashtra",
    operator: "WCL",
    type: "non-coking",
    lat: 19.95,
    lon: 79.3,
  },
  {
    name: "Godavari Valley",
    state: "Telangana",
    operator: "SCCL",
    type: "non-coking",
    lat: 18.6,
    lon: 79.55,
  },

  // ---- Lignite ----------------------------------------------------------
  {
    name: "Neyveli",
    state: "Tamil Nadu",
    operator: "NLC India",
    type: "lignite",
    lat: 11.6,
    lon: 79.48,
  },
  {
    name: "Kutch",
    state: "Gujarat",
    operator: "GMDC",
    type: "lignite",
    lat: 23.25,
    lon: 68.95,
  },

  // ---- North-east -------------------------------------------------------
  {
    name: "Makum",
    state: "Assam",
    operator: "NEC",
    type: "non-coking",
    lat: 27.3,
    lon: 95.7,
  },
];

export const TYPE_COLOUR: Record<CoalType, string> = {
  coking: "#b3261e",
  "non-coking": "#14539a",
  lignite: "#9a5c00",
};
