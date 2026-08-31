// Canonical list of license tiers offered at registration time. Shared by the
// API (validation + the public /api/license/tiers feed) so pricing and copy
// live in one place; the client renders whatever this feed returns.
const LICENSE_TIERS = [
  {
    id: "bronze",
    name: "Bronze",
    price: "$19.99",
    period: "week",
    priceLabel: "$19.99 / week",
    badge: "Free 1 Week Trial",
    blurb: "Week-to-week access to the full protocol. Cancel any time.",
    features: [
      "Daily Levrone-style TODO generator",
      "Body metrics log & trend charts",
      "Daily training notes"
    ]
  },
  {
    id: "silver",
    name: "Silver",
    price: "$59.99",
    period: "month",
    priceLabel: "$59.99 / month",
    badge: "Most Popular",
    blurb: "The usual pick — a full month of training for the price of a few weeks.",
    features: [
      "Everything in Bronze",
      "CSV import from RENPHO scales",
      "Full metric history retained"
    ]
  },
  {
    id: "gold",
    name: "Gold",
    price: "$599.99",
    period: "year",
    priceLabel: "$599.99 / year",
    badge: "Best Value",
    blurb: "Commit to the year and lock in the lowest effective rate.",
    features: [
      "Everything in Silver",
      "A full year of uninterrupted access",
      "Best value per month"
    ]
  }
];

const LICENSE_TIER_IDS = LICENSE_TIERS.map((t) => t.id);

// Optional coaching add-ons offered alongside a plan. A license carries at most
// one; picking none is fine.
const ADDITIONAL_SERVICES = [
  { id: "coaching-1x-month", label: "Kevin's Coaching - 1x per month", metal: "bronze", price: "$29", period: "month", priceLabel: "$29 / month" },
  { id: "coaching-2x-month", label: "Kevin's Coaching - 2x per month", metal: "silver", price: "$49", period: "month", priceLabel: "$49 / month" },
  { id: "coaching-1x-week", label: "Kevin's Coaching - 1x per week", metal: "gold", price: "$599", period: "year", priceLabel: "$599 / year" }
];

const ADDITIONAL_SERVICE_IDS = ADDITIONAL_SERVICES.map((s) => s.id);

module.exports = {
  LICENSE_TIERS,
  LICENSE_TIER_IDS,
  ADDITIONAL_SERVICES,
  ADDITIONAL_SERVICE_IDS
};
