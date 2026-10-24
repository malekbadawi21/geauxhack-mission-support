// baselines.ts — published reference values for water use, each with its source.
//
// How it fits: water.ts turns the crew's one stated water volume (Jan 13 "~360l") into "days left"
// at each of these rates. They are reference points, not predictions: neither was measured at MDRS.
// (Unlike constants.ts, these are real external figures, not our choices.) Browser-safe.

// NASA-STD-3001 ECLSS technical brief: minimum 2.5 L potable water per crewmember per day.
// Drinking water only, not total use (washing, cooking, toilet).
export const NASA_MIN_POTABLE_WATER_L_PER_CREW_DAY = 2.5;
export const NASA_MIN_POTABLE_WATER_SOURCE = "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-002-eclss.pdf";

// FMARS four-month analog study: average 12.12 L of water per crewmember per sol (24h 39m).
// Measured at a different analog station (Devon Island, Arctic).
export const FMARS_AVG_WATER_L_PER_CREW_SOL = 12.12;
export const FMARS_AVG_WATER_SOURCE = "https://core.ac.uk/works/63185982";
