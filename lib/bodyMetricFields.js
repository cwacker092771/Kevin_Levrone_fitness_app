// Canonical list of body composition metrics reported by RENPHO BIA scales
// (Elis / Elis Aspire / Elis Solar / MorphoScan, etc.). Shared by the DB
// layer, the API, and the CSV importer so column names, labels and units
// stay in one place.
//
// This covers all 13 measurements in RENPHO's standard set — weight, BMI, body
// fat, fat-free body weight, subcutaneous fat, visceral fat, body water,
// skeletal muscle, muscle mass, bone mass, protein, BMR, metabolic age — plus
// heart rate, which RENPHO's Elis Aspire / Solar models add. RENPHO reports
// muscle mass as a weight (lb/kg); some exports give it as a percentage, so
// both muscleMassLb and musclePct exist.
//
// The RENPHO MorphoScan (8-electrode segmental scale) additionally reports body
// fat mass, skeletal muscle mass and body water as weights (distinct from the
// percentage columns above), plus a bioimpedance phase angle. Segmental
// (per-limb) readings from that scale are not stored.
const BODY_METRIC_FIELDS = [
  { key: "weightLb", column: "weight_lb", label: "Weight", unit: " lbs" },
  { key: "bodyFatPct", column: "body_fat_pct", label: "Body Fat", unit: "%" },
  { key: "bodyWaterPct", column: "body_water_pct", label: "Body Water", unit: "%" },
  { key: "musclePct", column: "muscle_pct", label: "Muscle Mass", unit: "%" },
  { key: "muscleMassLb", column: "muscle_mass_lb", label: "Muscle Mass", unit: " lbs" },
  { key: "boneMassLb", column: "bone_mass_lb", label: "Bone Mass", unit: " lbs" },
  { key: "bmi", column: "bmi", label: "BMI", unit: "" },
  { key: "bmr", column: "bmr", label: "BMR", unit: " kcal" },
  { key: "visceralFat", column: "visceral_fat", label: "Visceral Fat", unit: "" },
  { key: "metabolicAge", column: "metabolic_age", label: "Metabolic Age", unit: " yrs" },
  { key: "proteinPct", column: "protein_pct", label: "Protein", unit: "%" },
  { key: "subcutaneousFatPct", column: "subcutaneous_fat_pct", label: "Subcutaneous Fat", unit: "%" },
  { key: "fatFreeWeightLb", column: "fat_free_weight_lb", label: "Fat-Free Body Weight", unit: " lbs" },
  { key: "skeletalMusclePct", column: "skeletal_muscle_pct", label: "Skeletal Muscle", unit: "%" },
  { key: "heartRateBpm", column: "heart_rate_bpm", label: "Heart Rate", unit: " bpm" },
  { key: "bodyFatMassLb", column: "body_fat_mass_lb", label: "Body Fat Mass", unit: " lbs" },
  { key: "skeletalMuscleMassLb", column: "skeletal_muscle_mass_lb", label: "Skeletal Muscle Mass", unit: " lbs" },
  { key: "bodyWaterMassLb", column: "body_water_mass_lb", label: "Body Water Mass", unit: " lbs" },
  { key: "phaseAngleDeg", column: "phase_angle_deg", label: "Phase Angle", unit: "°" }
];

module.exports = { BODY_METRIC_FIELDS };
