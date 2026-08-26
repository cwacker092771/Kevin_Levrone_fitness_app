// Canonical list of body composition metrics the INEVIFIT Eros scale reports.
// Shared by the DB layer, the API, and the CSV importer so column names,
// labels and units stay in one place.
const BODY_METRIC_FIELDS = [
  { key: "weightLb", column: "weight_lb", label: "Weight", unit: " lbs" },
  { key: "bodyFatPct", column: "body_fat_pct", label: "Body Fat", unit: "%" },
  { key: "bodyWaterPct", column: "body_water_pct", label: "Body Water", unit: "%" },
  { key: "musclePct", column: "muscle_pct", label: "Muscle Mass", unit: "%" },
  { key: "boneMassLb", column: "bone_mass_lb", label: "Bone Mass", unit: " lbs" },
  { key: "bmi", column: "bmi", label: "BMI", unit: "" },
  { key: "bmr", column: "bmr", label: "BMR", unit: " kcal" },
  { key: "visceralFat", column: "visceral_fat", label: "Visceral Fat", unit: "" },
  { key: "metabolicAge", column: "metabolic_age", label: "Metabolic Age", unit: " yrs" },
  { key: "proteinPct", column: "protein_pct", label: "Protein", unit: "%" },
  { key: "subcutaneousFatPct", column: "subcutaneous_fat_pct", label: "Subcutaneous Fat", unit: "%" },
  { key: "fatFreeWeightLb", column: "fat_free_weight_lb", label: "Fat-Free Body Weight", unit: " lbs" },
  { key: "skeletalMusclePct", column: "skeletal_muscle_pct", label: "Skeletal Muscle", unit: "%" }
];

module.exports = { BODY_METRIC_FIELDS };
