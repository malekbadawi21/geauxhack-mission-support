// baselines.ts — published reference values for water use, each with its source.
//
// How it fits: these would let the tool compare the crew's water use to real standards. They only
// apply if water use can be computed in LITERS from the reports. For Crew 147 it can't: the static
// tank is reported as a depth in cm with no tank capacity, and the loft tank only as "filled". So
// nothing imports these yet; they are kept, unused, for when a report gives volumes or a capacity.
// (Unlike constants.ts, these are real external figures, not our choices.) Browser-safe.

// NASA-STD-3001 ECLSS technical brief: minimum 2.5 L potable water per crewmember per day.
// Source: https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-002-eclss.pdf
export const NASA_MIN_POTABLE_WATER_L_PER_CREW_DAY = 2.5;

// FMARS four-month analog study: average 12.12 L of water per crewmember per sol.
// Source: https://core.ac.uk/works/63185982
export const FMARS_AVG_WATER_L_PER_CREW_SOL = 12.12;
