(function () {
  "use strict";

  const form = document.getElementById("planForm");
  const resultsPanel = document.getElementById("resultsPanel");
  const statsGrid = document.getElementById("statsGrid");
  const statsDateTag = document.getElementById("statsDateTag");
  const todoGroups = document.getElementById("todoGroups");
  const resetBtn = document.getElementById("resetBtn");
  const noPlanHint = document.getElementById("noPlanHint");

  const calMonthLabel = document.getElementById("calMonthLabel");
  const calendarGrid = document.getElementById("calendarGrid");
  const calPrev = document.getElementById("calPrev");
  const calNext = document.getElementById("calNext");
  const calToday = document.getElementById("calToday");
  const selectedDateLabel = document.getElementById("selectedDateLabel");

  const metricsForm = document.getElementById("metricsForm");
  const metricsDateTag = document.getElementById("metricsDateTag");
  const metricsSavedTag = document.getElementById("metricsSavedTag");
  const chartsGrid = document.getElementById("chartsGrid");
  const csvImportBtn = document.getElementById("csvImportBtn");
  const csvFileInput = document.getElementById("csvFileInput");
  const csvImportResult = document.getElementById("csvImportResult");
  const scaleConnectBtn = document.getElementById("scaleConnectBtn");
  const scaleStatus = document.getElementById("scaleStatus");
  const scaleImportResult = document.getElementById("scaleImportResult");

  const notesForm = document.getElementById("notesForm");
  const notesDateTag = document.getElementById("notesDateTag");
  const noteText = document.getElementById("noteText");
  const noteSavedTag = document.getElementById("noteSavedTag");

  // Mirrors lib/bodyMetricFields.js on the server — keep in sync.
  const BODY_METRIC_FIELDS = [
    { key: "weightLb", label: "Weight", unit: " lbs", color: "var(--gold)" },
    { key: "bodyFatPct", label: "Body Fat", unit: "%", color: "var(--red)" },
    { key: "fatFreeWeightLb", label: "Fat-Free Body Weight", unit: " lbs", color: "#45b8ac" },
    { key: "bodyWaterPct", label: "Body Water", unit: "%", color: "#4a90d9" },
    { key: "musclePct", label: "Muscle Mass (%)", unit: "%", color: "#5cb85c" },
    { key: "muscleMassLb", label: "Muscle Mass (lbs)", unit: " lbs", color: "#3fa34d" },
    { key: "skeletalMusclePct", label: "Skeletal Muscle", unit: "%", color: "#a3b93c" },
    { key: "boneMassLb", label: "Bone Mass", unit: " lbs", color: "#e08a3c" },
    { key: "bmi", label: "BMI", unit: "", color: "#9b7fd4" },
    { key: "bmr", label: "BMR", unit: " kcal", color: "#d46fa2" },
    { key: "visceralFat", label: "Visceral Fat", unit: "", color: "#7a93b0" },
    { key: "metabolicAge", label: "Metabolic Age", unit: " yrs", color: "#b08d57" },
    { key: "proteinPct", label: "Protein", unit: "%", color: "#8bc34a" },
    { key: "subcutaneousFatPct", label: "Subcutaneous Fat", unit: "%", color: "#e08080" },
    { key: "heartRateBpm", label: "Heart Rate", unit: " bpm", color: "#e0556b" },
    { key: "bodyFatMassLb", label: "Body Fat Mass", unit: " lbs", color: "#c85a6d" },
    { key: "skeletalMuscleMassLb", label: "Skeletal Muscle Mass", unit: " lbs", color: "#8a9a2b" },
    { key: "bodyWaterMassLb", label: "Body Water Mass", unit: " lbs", color: "#3f7fc0" },
    { key: "phaseAngleDeg", label: "Phase Angle", unit: "°", color: "#5cbdb0" }
  ];

  function pad2(n) { return String(n).padStart(2, "0"); }

  function toLocalDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function parseLocalDateStr(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateLong(dateStr) {
    return parseLocalDateStr(dateStr).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }

  function formatDateShort(dateStr) {
    return parseLocalDateStr(dateStr).toLocaleDateString("en-US", {
      month: "short", day: "numeric"
    });
  }

  const todayStr = toLocalDateStr(new Date());

  const calState = {
    selectedDate: todayStr,
    viewYear: parseLocalDateStr(todayStr).getFullYear(),
    viewMonth: parseLocalDateStr(todayStr).getMonth() + 1,
    datesWithPlans: new Set(),
    datesWithNotes: new Set()
  };

  let currentPlan = null;

  function fmt(n) { return n.toLocaleString("en-US"); }

  function lbToKg(lb) { return lb * 0.453592; }
  function inToCm(inches) { return inches * 2.54; }

  function calcBMR(sex, weightLb, heightIn, age) {
    const kg = lbToKg(weightLb);
    const cm = inToCm(heightIn);
    const base = 10 * kg + 6.25 * cm - 5 * age;
    return sex === "male" ? base + 5 : base - 161;
  }

  function calcGoalCalories(tdee, goal) {
    switch (goal) {
      case "cut": return Math.round(tdee - tdee * 0.2);
      case "bulk": return Math.round(tdee + 300);
      case "recomp": return Math.round(tdee - 150);
      default: return Math.round(tdee);
    }
  }

  function calcMacros(weightLb, goal, calories) {
    // Levrone-style: protein stays high regardless of goal, carbs flex with goal.
    let proteinPerLb;
    let fatPct;
    switch (goal) {
      case "cut": proteinPerLb = 1.3; fatPct = 0.25; break;
      case "bulk": proteinPerLb = 1.1; fatPct = 0.25; break;
      case "recomp": proteinPerLb = 1.3; fatPct = 0.25; break;
      default: proteinPerLb = 1.1; fatPct = 0.28; break;
    }
    const proteinG = Math.round(weightLb * proteinPerLb);
    const proteinCal = proteinG * 4;
    const fatCal = calories * fatPct;
    const fatG = Math.round(fatCal / 9);
    const carbCal = Math.max(calories - proteinCal - fatCal, 0);
    const carbG = Math.round(carbCal / 4);
    return { proteinG, fatG, carbG };
  }

  function calcLeanMass(weightLb, bodyfat) {
    if (!bodyfat) return null;
    return Math.round(weightLb * (1 - bodyfat / 100));
  }

  function buildTodo(data) {
    const { sex, age, weightLb, heightIn, bodyfat, activity, goal, experience, days, supplements, stimulantsOk } = data;

    const bmr = calcBMR(sex, weightLb, heightIn, age);
    const tdee = bmr * activity;
    const calories = calcGoalCalories(tdee, goal);
    const macros = calcMacros(weightLb, goal, calories);
    const leanMass = calcLeanMass(weightLb, bodyfat);

    const stats = [
      { label: "BMR", value: `${fmt(Math.round(bmr))} kcal` },
      { label: "Maintenance (TDEE)", value: `${fmt(Math.round(tdee))} kcal` },
      { label: "Target Calories", value: `${fmt(calories)} kcal` },
      { label: "Protein", value: `${fmt(macros.proteinG)} g` },
      { label: "Carbs", value: `${fmt(macros.carbG)} g` },
      { label: "Fat", value: `${fmt(macros.fatG)} g` }
    ];
    if (leanMass) stats.push({ label: "Lean Body Mass", value: `${fmt(leanMass)} lbs` });

    const groups = [];

    // ---- Nutrition ----
    const nutrition = [
      { id: "nutr-cal", text: `Hit ~${calories} calories/day (${goal === "cut" ? "a controlled deficit" : goal === "bulk" ? "a lean surplus" : goal === "recomp" ? "a slight deficit with high protein" : "maintenance"}), tracked daily.` },
      { id: "nutr-protein", text: `Eat ${macros.proteinG}g protein/day — Levrone trained on the belief that a bodybuilder's diet is built on protein first. Prioritize lean beef, chicken, egg whites, fish, and a whey shake or two.` },
      { id: "nutr-carbs", text: `Hit ~${macros.carbG}g carbs/day from clean sources: rice, oats, potatoes, and fruit. Time the biggest carb meals around training.` },
      { id: "nutr-fat", text: `Keep fat around ${macros.fatG}g/day from whole eggs, olive oil, nuts, and fatty fish — don't fear fat, just don't overdo it.` },
      { id: "nutr-meals", text: "Split intake into 5-6 meals across the day instead of 2-3 big ones, to keep protein synthesis and energy steady." },
      { id: "nutr-water", text: `Drink at least 1 gallon of water per day — more on training days.` },
      { id: "nutr-junk", text: "Cut processed sugar and fried food to the bare minimum; save any treat meal for one planned sitting per week." }
    ];
    if (goal === "cut") {
      nutrition.push({ id: "nutr-cut-cardio-food", text: "On heavier cardio days, shift a small amount of carbs earlier in the day and keep fats lower to protect the deficit." });
    }
    if (goal === "bulk") {
      nutrition.push({ id: "nutr-bulk-checkin", text: "Weigh in weekly — if you're gaining less than 0.5 lb/week, add 150-200 clean calories; if gaining fast and getting soft, pull back the same amount." });
    }
    groups.push({ title: "Nutrition", items: nutrition });

    // ---- Training ----
    const training = [
      { id: "train-split", text: buildSplitRecommendation(days, experience) },
      { id: "train-heavy", text: "Anchor each session with 1-2 heavy compound lifts (squat, deadlift, bench, row, overhead press) — Levrone built his base on heavy, hard sets on the big movements." },
      { id: "train-volume", text: experience === "beginner"
          ? "Keep volume moderate: 3-4 exercises per muscle group, 3 sets of 8-12 reps, focus on clean form before chasing heavier weight."
          : "Train with high intensity and volume: 4-6 exercises per muscle group, mixing 6-10 rep heavy sets with some higher-rep burnout sets to failure." },
      { id: "train-instinct", text: "Train instinctively — if a muscle group is lagging or still fired up, give it extra attention or an extra day rather than following a rigid plan blindly." },
      { id: "train-progressive", text: "Track your lifts and aim to add reps or weight over time on your main compound movements — progressive overload is non-negotiable." },
      { id: "train-abs", text: "Train abs/core 3-4x per week — it was a near-daily staple in Levrone's routine." },
      { id: "train-warmup", text: "Always warm up properly on heavy compound lifts with 2-3 ramp-up sets before working weight, to protect joints for the long haul." }
    ];
    if (goal === "cut" || goal === "recomp") {
      training.push({ id: "train-cardio", text: "Add 3-5 sessions of 20-30 min moderate cardio (incline walk or bike) per week to support the calorie deficit without eating into recovery." });
    }
    groups.push({ title: "Training", items: training });

    // ---- Supplements ----
    const suppCopy = {
      protein: "Take a whey or casein protein shake to help hit your daily protein target, especially post-workout and between meals.",
      creatine: "Take 5g creatine monohydrate daily (any time of day) to support strength and muscle fullness — one of the most proven strength supplements.",
      preworkout: stimulantsOk
        ? "Use a pre-workout 20-30 min before training on days you need extra intensity or focus — cycle off it every 6-8 weeks."
        : "Use a stimulant-free pre-workout (citrulline, beta-alanine, creatine-based) 20-30 min before training since you'd rather skip caffeine and other stimulants.",
      fatburner: stimulantsOk
        ? "If cutting, consider a thermogenic/fat burner on training days to support energy and appetite control — never as a substitute for diet discipline."
        : "If cutting, consider a stimulant-free fat burner (e.g. L-carnitine, green tea extract, CLA) to support the diet without caffeine or other stimulants.",
      massgainer: "If bulking and struggling to eat enough, add a mass gainer shake between meals to close the calorie gap.",
      aminos: "Sip BCAA/EAA during fasted training or long sessions to help protect muscle and support recovery.",
      multi: "Take a daily multivitamin to cover micronutrient gaps from intense training and dieting.",
      fishoil: "Take 2-3g fish oil (omega-3) daily to support joint health and recovery from heavy training.",
      vitamind: "Take 2000-5000 IU vitamin D3 daily, especially if you get limited sun exposure.",
      joint: "Take a joint support supplement (glucosamine, chondroitin, or collagen) daily to protect joints under heavy loads over time.",
      zma: "Take ZMA or a magnesium/zinc combo before bed to support sleep quality and recovery."
    };
    const supplementItems = supplements
      .filter((s) => suppCopy[s])
      .map((s) => ({ id: `supp-${s}`, text: suppCopy[s] }));
    if (supplementItems.length === 0) {
      supplementItems.push({ id: "supp-none", text: "No supplements selected — focus on whole-food nutrition first; supplements only support the diet, they don't replace it." });
    }
    groups.push({ title: "Supplements", items: supplementItems });

    // ---- Lifestyle & Recovery ----
    const lifestyle = [
      { id: "life-sleep", text: "Get 7-9 hours of sleep per night — this is when the muscle you train for actually gets built." },
      { id: "life-consistency", text: "Show up for every planned training session this week, even on low-motivation days — consistency beats any single perfect workout." },
      { id: "life-photos", text: "Take a weekly progress photo and body weight check-in, same time of day, same conditions, to track real change." },
      { id: "life-deload", text: "Plan a lighter deload week every 6-8 weeks of hard training to let joints and the nervous system recover." },
      { id: "life-mindset", text: "Keep a short training log — Levrone's approach was as much about mental toughness and discipline as it was about the weights." }
    ];
    groups.push({ title: "Lifestyle & Recovery", items: lifestyle });

    return { stats, groups };
  }

  function buildSplitRecommendation(days, experience) {
    const d = parseInt(days, 10);
    if (d <= 3) {
      return `Run a 3-day full-body split (e.g. Mon/Wed/Fri) hitting every major muscle group each session, since you have ${d} training days available.`;
    }
    if (d === 4) {
      return "Run a 4-day upper/lower split (Upper, Lower, rest, Upper, Lower) to balance recovery with enough frequency per muscle group.";
    }
    if (d === 5) {
      return "Run a 5-day body-part split (e.g. Chest, Back, Legs, Shoulders, Arms) in classic old-school bodybuilding style — one muscle group hit hard per day.";
    }
    return "Run a 6-day push/pull/legs split, repeated twice per week, to maximize the frequency and volume Levrone-style training thrives on.";
  }

  function renderStats(stats) {
    statsGrid.innerHTML = "";
    stats.forEach((s) => {
      const card = document.createElement("div");
      card.className = "stat-card";
      card.innerHTML = `<div class="value">${s.value}</div><div class="label">${s.label}</div>`;
      statsGrid.appendChild(card);
    });
  }

  const GROUP_ICONS = {
    Nutrition: '<svg class="group-icon" viewBox="0 0 24 24"><path d="M7 2v7a2 2 0 0 0 2 2v11M7 2v9M11 2v9"/><path d="M17 2c-1.5 1.5-2 3-2 6s.5 4 2 6v8"/></svg>',
    Training: '<svg class="group-icon" viewBox="0 0 24 24"><rect x="1" y="6" width="2" height="12" rx="1"/><rect x="4" y="8" width="2" height="8" rx="1"/><path d="M6 12h12"/><rect x="18" y="8" width="2" height="8" rx="1"/><rect x="21" y="6" width="2" height="12" rx="1"/></svg>',
    Supplements: '<svg class="group-icon" viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M6 12h12"/></svg>',
    "Lifestyle & Recovery": '<svg class="group-icon" viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>'
  };

  function renderTodo(groups, checked) {
    todoGroups.innerHTML = "";

    groups.forEach((group) => {
      const groupEl = document.createElement("div");
      groupEl.className = "todo-group";

      const doneCount = group.items.filter((i) => checked[i.id]).length;
      const icon = GROUP_ICONS[group.title] || "";
      groupEl.innerHTML = `<h3>${icon}${group.title} <span class="count">(${doneCount}/${group.items.length} done)</span></h3>`;

      const list = document.createElement("ul");
      list.className = "todo-list";

      group.items.forEach((item) => {
        const li = document.createElement("li");
        const isDone = !!checked[item.id];
        li.className = "todo-item" + (isDone ? " done" : "");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = item.id;
        checkbox.checked = isDone;

        const label = document.createElement("label");
        label.htmlFor = item.id;
        label.textContent = item.text;

        checkbox.addEventListener("change", async () => {
          const wantChecked = checkbox.checked;
          checkbox.disabled = true;
          try {
            const plan = await api(`/api/plans/${calState.selectedDate}/items/${encodeURIComponent(item.id)}`, {
              method: "PATCH",
              body: { checked: wantChecked }
            });
            currentPlan = plan;
            li.classList.toggle("done", wantChecked);
            const countEl = groupEl.querySelector(".count");
            const done = group.items.filter((i) => plan.checked[i.id]).length;
            countEl.textContent = `(${done}/${group.items.length} done)`;
          } catch (err) {
            checkbox.checked = !wantChecked;
            console.error("Failed to save checkbox state:", err);
          } finally {
            checkbox.disabled = false;
          }
        });

        li.appendChild(checkbox);
        li.appendChild(label);
        list.appendChild(li);
      });

      groupEl.appendChild(list);
      todoGroups.appendChild(groupEl);
    });
  }

  function showFormError(message) {
    let el = document.getElementById("formError");
    if (!el) {
      el = document.createElement("p");
      el.id = "formError";
      el.className = "form-error";
      form.querySelector(".actions").insertAdjacentElement("afterend", el);
    }
    el.textContent = message;
    el.hidden = false;
  }

  function clearFormError() {
    const el = document.getElementById("formError");
    if (el) el.hidden = true;
  }

  async function api(url, options) {
    const opts = options || {};
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 404) return null;
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error("not_authenticated");
    }
    if (res.status === 402) {
      handleLicenseRequired();
      throw new Error("license_required");
    }
    if (res.status === 403) {
      let body = {};
      try { body = await res.clone().json(); } catch (e) { /* ignore */ }
      if (body.error === "service_canceled") {
        applyServiceStatus({ status: "canceled" });
        throw new Error("service_canceled");
      }
    }
    if (!res.ok) {
      let message = `Request failed: ${res.status}`;
      try {
        const body = await res.json();
        if (body && body.error) message = body.error;
      } catch (e) { /* ignore non-JSON error bodies */ }
      throw new Error(message);
    }
    return res.json();
  }

  function readFormData() {
    const fd = new FormData(form);
    return {
      sex: fd.get("sex"),
      age: parseInt(fd.get("age"), 10),
      weightLb: parseFloat(fd.get("weight")),
      heightIn: parseFloat(fd.get("heightFt")) * 12 + parseFloat(fd.get("heightIn")),
      bodyfat: fd.get("bodyfat") ? parseFloat(fd.get("bodyfat")) : null,
      activity: parseFloat(fd.get("activity")),
      goal: fd.get("goal"),
      experience: fd.get("experience"),
      days: fd.get("days"),
      supplements: fd.getAll("supp"),
      stimulantsOk: fd.get("stimulantsOk") === "on"
    };
  }

  function populateForm(inputs) {
    form.sex.value = inputs.sex;
    form.age.value = inputs.age;
    form.heightFt.value = Math.floor(inputs.heightIn / 12);
    form.heightIn.value = Math.round(inputs.heightIn % 12);
    form.weight.value = inputs.weightLb;
    form.bodyfat.value = inputs.bodyfat || "";
    form.activity.value = inputs.activity;
    form.goal.value = inputs.goal;
    form.experience.value = inputs.experience;
    form.days.value = inputs.days;
    form.stimulantsOk.checked = !!inputs.stimulantsOk;
    [...form.querySelectorAll('input[name="supp"]')].forEach((cb) => {
      cb.checked = inputs.supplements.includes(cb.value);
    });
  }

  function renderPlan(plan) {
    currentPlan = plan;
    statsDateTag.textContent = formatDateLong(plan.date);
    renderStats(plan.stats);
    renderTodo(plan.groups, plan.checked || {});
    resultsPanel.hidden = false;
    noPlanHint.hidden = true;
  }

  function showNoPlan() {
    currentPlan = null;
    resultsPanel.hidden = true;
    noPlanHint.hidden = false;
  }

  async function loadPlanForDate(dateStr) {
    selectedDateLabel.textContent = formatDateLong(dateStr);
    try {
      const plan = await api(`/api/plans/${dateStr}`);
      if (plan) {
        populateForm(plan.inputs);
        renderPlan(plan);
      } else {
        showNoPlan();
      }
    } catch (err) {
      console.error("Failed to load plan:", err);
      showNoPlan();
    }
  }

  async function refreshMonthDots() {
    try {
      const data = await api(`/api/plans/dates?year=${calState.viewYear}&month=${calState.viewMonth}`);
      calState.datesWithPlans = new Set((data && data.dates) || []);
    } catch (err) {
      calState.datesWithPlans = new Set();
    }
    try {
      const data = await api(`/api/notes/dates?year=${calState.viewYear}&month=${calState.viewMonth}`);
      calState.datesWithNotes = new Set((data && data.dates) || []);
    } catch (err) {
      calState.datesWithNotes = new Set();
    }
    renderCalendarGrid();
  }

  function renderCalendarGrid() {
    calMonthLabel.textContent = new Date(calState.viewYear, calState.viewMonth - 1, 1)
      .toLocaleDateString("en-US", { month: "long", year: "numeric" });

    calendarGrid.innerHTML = "";
    const firstWeekday = new Date(calState.viewYear, calState.viewMonth - 1, 1).getDay();
    const daysInMonth = new Date(calState.viewYear, calState.viewMonth, 0).getDate();

    for (let i = 0; i < firstWeekday; i++) {
      const blank = document.createElement("span");
      blank.className = "cal-day cal-day-blank";
      calendarGrid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${calState.viewYear}-${pad2(calState.viewMonth)}-${pad2(day)}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      btn.textContent = day;
      if (dateStr === todayStr) btn.classList.add("cal-today");
      if (dateStr === calState.selectedDate) btn.classList.add("cal-selected");
      if (calState.datesWithPlans.has(dateStr)) btn.classList.add("cal-has-plan");
      if (calState.datesWithNotes.has(dateStr)) btn.classList.add("cal-has-note");
      btn.addEventListener("click", () => selectDate(dateStr));
      calendarGrid.appendChild(btn);
    }
  }

  function selectDate(dateStr) {
    calState.selectedDate = dateStr;
    const d = parseLocalDateStr(dateStr);
    calState.viewYear = d.getFullYear();
    calState.viewMonth = d.getMonth() + 1;
    refreshMonthDots();
    loadPlanForDate(dateStr);
    metricsSavedTag.hidden = true;
    metricsDateTag.textContent = formatDateLong(dateStr);
    loadMetricForDate(dateStr);
    noteSavedTag.hidden = true;
    notesDateTag.textContent = formatDateLong(dateStr);
    loadNoteForDate(dateStr);
  }

  calPrev.addEventListener("click", () => {
    calState.viewMonth -= 1;
    if (calState.viewMonth < 1) { calState.viewMonth = 12; calState.viewYear -= 1; }
    refreshMonthDots();
  });

  calNext.addEventListener("click", () => {
    calState.viewMonth += 1;
    if (calState.viewMonth > 12) { calState.viewMonth = 1; calState.viewYear += 1; }
    refreshMonthDots();
  });

  calToday.addEventListener("click", () => {
    const d = parseLocalDateStr(todayStr);
    calState.viewYear = d.getFullYear();
    calState.viewMonth = d.getMonth() + 1;
    selectDate(todayStr);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError();
    const inputs = readFormData();
    const { stats, groups } = buildTodo(inputs);
    try {
      const plan = await api(`/api/plans/${calState.selectedDate}`, {
        method: "POST",
        body: { inputs, stats, groups }
      });
      renderPlan(plan);
      refreshMonthDots();
      resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      refreshGoalImage(inputs);
    } catch (err) {
      console.error("Failed to save plan:", err);
      showFormError("Could not save this plan — check that the server and database are running.");
    }
  });

  resetBtn.addEventListener("click", async () => {
    if (!currentPlan) return;
    try {
      const plan = await api(`/api/plans/${calState.selectedDate}/reset-checked`, { method: "POST" });
      renderPlan(plan);
    } catch (err) {
      console.error("Failed to reset checklist:", err);
    }
  });

  function fmt1(n) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function drawLineChart(container, points, opts) {
    container.innerHTML = "";
    if (points.length < 2) {
      container.innerHTML = '<p class="chart-empty">Log at least 2 days to see a trend.</p>';
      return;
    }

    const width = 560;
    const height = 200;
    const padL = 46;
    const padR = 12;
    const padT = 14;
    const padB = 26;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const times = points.map((p) => parseLocalDateStr(p.date).getTime());
    const values = points.map((p) => p.value);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const valPad = (maxVal - minVal) * 0.15 || 1;
    const yMin = minVal - valPad;
    const yMax = maxVal + valPad;

    const xPos = (t) => (maxTime === minTime ? padL + innerW / 2 : padL + ((t - minTime) / (maxTime - minTime)) * innerW);
    const yPos = (v) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    const coords = points.map((p) => ({
      x: xPos(parseLocalDateStr(p.date).getTime()),
      y: yPos(p.value),
      date: p.date,
      value: p.value
    }));

    const linePath = coords.map((c, i) => (i === 0 ? "M" : "L") + c.x.toFixed(1) + "," + c.y.toFixed(1)).join(" ");

    const gridCount = 3;
    let gridLines = "";
    let gridLabels = "";
    for (let i = 0; i <= gridCount; i++) {
      const v = yMin + (yMax - yMin) * (i / gridCount);
      const y = yPos(v);
      gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" class="chart-grid"/>`;
      gridLabels += `<text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" class="chart-axis-label" text-anchor="end">${fmt1(v)}</text>`;
    }

    const markers = coords.map((c) =>
      `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" class="chart-point" style="stroke:${opts.color}"/>`
    ).join("");

    container.innerHTML = `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="none">
          ${gridLines}
          ${gridLabels}
          <path d="${linePath}" class="chart-line" style="stroke:${opts.color}"/>
          ${markers}
          <line class="chart-crosshair" x1="0" y1="${padT}" x2="0" y2="${height - padB}" style="display:none"></line>
          <text x="${padL}" y="${height - 8}" class="chart-axis-label">${formatDateShort(points[0].date)}</text>
          <text x="${width - padR}" y="${height - 8}" class="chart-axis-label" text-anchor="end">${formatDateShort(points[points.length - 1].date)}</text>
        </svg>
        <div class="chart-tooltip" hidden></div>
      </div>
    `;

    const svg = container.querySelector(".chart-svg");
    const crosshair = container.querySelector(".chart-crosshair");
    const tooltip = container.querySelector(".chart-tooltip");

    svg.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * width;
      let nearest = coords[0];
      let minDist = Infinity;
      coords.forEach((c) => {
        const d = Math.abs(c.x - mouseX);
        if (d < minDist) { minDist = d; nearest = c; }
      });
      crosshair.setAttribute("x1", nearest.x);
      crosshair.setAttribute("x2", nearest.x);
      crosshair.style.display = "block";
      tooltip.hidden = false;
      tooltip.textContent = `${formatDateShort(nearest.date)}: ${fmt1(nearest.value)}${opts.unit}`;
      tooltip.style.left = `${(nearest.x / width) * rect.width}px`;
      tooltip.style.top = `${(nearest.y / height) * rect.height - 8}px`;
    });

    svg.addEventListener("mouseleave", () => {
      crosshair.style.display = "none";
      tooltip.hidden = true;
    });
  }

  function buildChartCard(title, points, opts) {
    const card = document.createElement("div");
    card.className = "chart-card";

    let latestHtml = "";
    if (points.length > 0) {
      const latest = points[points.length - 1].value;
      let deltaHtml = "";
      if (points.length > 1) {
        const delta = latest - points[0].value;
        const sign = delta > 0 ? "+" : "";
        deltaHtml = `<span class="delta">${sign}${fmt1(delta)}${opts.unit} since ${formatDateShort(points[0].date)}</span>`;
      }
      latestHtml = `<div class="chart-latest"><span class="value">${fmt1(latest)}${opts.unit}</span>${deltaHtml}</div>`;
    }

    card.innerHTML = `
      <div class="chart-card-header">
        <span class="chart-title">${title}</span>
        ${latestHtml}
      </div>
      <div class="chart-body"></div>
    `;

    drawLineChart(card.querySelector(".chart-body"), points, opts);
    return card;
  }

  function renderCharts(allMetrics) {
    chartsGrid.innerHTML = "";

    for (const field of BODY_METRIC_FIELDS) {
      let points;
      if (field.key === "fatFreeWeightLb") {
        // Fall back to a computed value (weight * (1 - bodyfat%)) on days
        // the scale/CSV didn't report fat-free weight directly.
        points = allMetrics
          .map((m) => {
            if (m.fatFreeWeightLb != null) return { date: m.date, value: m.fatFreeWeightLb };
            if (m.weightLb != null && m.bodyFatPct != null) {
              return { date: m.date, value: m.weightLb * (1 - m.bodyFatPct / 100) };
            }
            return null;
          })
          .filter(Boolean);
      } else {
        points = allMetrics
          .filter((m) => m[field.key] != null)
          .map((m) => ({ date: m.date, value: m[field.key] }));
      }

      if (points.length === 0) continue;
      chartsGrid.appendChild(buildChartCard(field.label, points, { color: field.color, unit: field.unit }));
    }
  }

  async function loadAllMetricsAndRenderCharts() {
    try {
      const data = await api("/api/metrics");
      renderCharts((data && data.metrics) || []);
    } catch (err) {
      console.error("Failed to load metrics:", err);
      renderCharts([]);
    }
  }

  async function loadMetricForDate(dateStr) {
    try {
      const metric = await api(`/api/metrics/${dateStr}`);
      for (const field of BODY_METRIC_FIELDS) {
        const input = metricsForm.elements.namedItem(field.key);
        if (input) input.value = metric && metric[field.key] != null ? metric[field.key] : "";
      }
    } catch (err) {
      console.error("Failed to load metric for date:", err);
    }
  }

  metricsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = calState.selectedDate;

    const body = {};
    let hasAnyValue = false;
    for (const field of BODY_METRIC_FIELDS) {
      const input = metricsForm.elements.namedItem(field.key);
      const value = input && input.value !== "" ? parseFloat(input.value) : null;
      body[field.key] = value;
      if (value != null) hasAnyValue = true;
    }
    if (!hasAnyValue) return;

    try {
      await api(`/api/metrics/${date}`, { method: "POST", body });
      metricsSavedTag.hidden = false;
      loadAllMetricsAndRenderCharts();
    } catch (err) {
      console.error("Failed to save body metrics:", err);
    }
  });

  async function loadNoteForDate(dateStr) {
    try {
      const data = await api(`/api/notes/${dateStr}`);
      noteText.value = (data && data.note) || "";
    } catch (err) {
      console.error("Failed to load note for date:", err);
    }
  }

  noteText.addEventListener("input", () => {
    noteSavedTag.hidden = true;
  });

  notesForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = calState.selectedDate;
    try {
      await api(`/api/notes/${date}`, { method: "POST", body: { note: noteText.value } });
      noteSavedTag.hidden = false;
      refreshMonthDots();
    } catch (err) {
      console.error("Failed to save note:", err);
    }
  });

  csvImportBtn.addEventListener("click", () => {
    csvFileInput.click();
  });

  csvFileInput.addEventListener("change", async () => {
    const file = csvFileInput.files[0];
    csvFileInput.value = "";
    if (!file) return;

    csvImportResult.hidden = false;
    csvImportResult.textContent = "Importing...";

    try {
      const text = await file.text();
      const data = await api("/api/metrics/import-csv", { method: "POST", body: { csv: text } });
      const cols = data.matchedColumns || {};
      const colSummary = `date="${cols.date || "?"}" weight="${cols.weight || "?"}" bodyFat="${cols.bodyFat || "?"}"`;
      csvImportResult.textContent = `Imported ${data.imported} entries (${data.skipped.length} skipped). Matched columns: ${colSummary}`;
      loadAllMetricsAndRenderCharts();
      loadMetricForDate(calState.selectedDate);
    } catch (err) {
      console.error("Failed to import CSV:", err);
      csvImportResult.textContent = `Import failed: ${err.message}`;
    }
  });

  // -------------------------------------------------------------------------
  // Bluetooth scale — auto-import a weigh-in the moment the user steps off.
  //
  // Talks straight to the scale over Web Bluetooth. Supported on Chrome / Edge
  // (desktop + Android) over a secure origin (HTTPS or localhost); not on
  // iOS / Safari / Firefox. The scale only reports weight + bioimpedance, so
  // the body-composition numbers here are ESTIMATES computed from that plus
  // the age / height / sex on the planner form — not the vendor app's figures.
  //
  // Protocol: Xiaomi "Mi Body Composition" style. Service 0x1A10; the notifying
  // characteristic (0x1A11 on known devices, otherwise auto-detected) pushes
  // 13-byte packets:
  //   [0]      unit / control flags   (bit0 = lb, bit4 = catty, else kg)
  //   [1]      status flags           (bit1 = impedance present, bit5 = stable)
  //   [2..8]   device timestamp       (ignored - we log against today)
  //   [9..10]  impedance, ohms, little-endian
  //   [11..12] raw weight, little-endian  (/200 kg, /100 lb or catty)
  // A 10-byte weight-only variant (older scales) is also handled.
  //
  // Device-specific byte parsing is confined to parseScalePacket(); if a
  // capture from the real scale disagrees, that is the only function to touch.
  // -------------------------------------------------------------------------
  const SCALE_SERVICE = "00001a10-0000-1000-8000-00805f9b34fb";

  let scaleDevice = null;
  let scaleChar = null;
  let scalePollTimer = null;
  let scaleArmed = true;          // ready to accept the next completed weigh-in
  let scaleImporting = false;
  let scaleUserDisconnected = false;
  let scaleReconnectAttempts = 0;

  function scaleSupported() {
    return !!(navigator.bluetooth && window.isSecureContext);
  }

  function setScaleStatus(text, cls) {
    if (!scaleStatus) return;
    scaleStatus.textContent = text;
    scaleStatus.className = "scale-status" + (cls ? " " + cls : "");
  }

  function round1(n) { return Math.round(n * 10) / 10; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function parseScalePacket(dv) {
    if (dv.byteLength >= 13) {
      const b0 = dv.getUint8(0);
      const b1 = dv.getUint8(1);
      const impedance = dv.getUint16(9, true);
      const raw = dv.getUint16(11, true);
      let weightKg;
      if (b0 & 0x01) weightKg = (raw / 100) * 0.45359237;       // lb
      else if (b0 & 0x10) weightKg = (raw / 100) * 0.5;         // catty
      else weightKg = raw / 200;                                // kg
      return {
        weightKg,
        impedance,
        stabilized: (b1 & 0x20) !== 0,
        hasImpedance: (b1 & 0x02) !== 0 && impedance > 0 && impedance < 3000
      };
    }
    if (dv.byteLength >= 3) {
      const b0 = dv.getUint8(0);
      const raw = dv.getUint16(1, true);
      const weightKg = (b0 & 0x01) ? (raw / 100) * 0.45359237 : raw / 200;
      return { weightKg, impedance: 0, stabilized: (b0 & 0x20) !== 0, hasImpedance: false };
    }
    return null;
  }

  function readProfile() {
    const sex = form.sex ? form.sex.value : null;
    const age = form.age && form.age.value !== "" ? parseInt(form.age.value, 10) : null;
    let heightCm = null;
    if (form.heightFt && form.heightFt.value !== "") {
      const inches = parseFloat(form.heightFt.value) * 12 + parseFloat(form.heightIn.value || 0);
      if (isFinite(inches) && inches > 0) heightCm = inToCm(inches);
    }
    return { sex, age, heightCm };
  }

  function boneMassKg(male, weightKg, ffm) {
    let base;
    if (male) base = weightKg < 60 ? 2.66 : weightKg < 75 ? 3.19 : 3.69;
    else base = weightKg < 50 ? 1.95 : weightKg < 60 ? 2.40 : 2.95;
    return base + (ffm - (male ? 55 : 43)) * 0.0045;
  }

  // Published consumer-BIA regressions: Sun et al. (2003) for fat-free mass,
  // Janssen et al. (2000) for skeletal muscle. Deliberately simple and clearly
  // approximate - the vendor app's proprietary curve will differ.
  function estimateBodyComposition(p) {
    const { weightKg, impedance, heightCm, age } = p;
    const male = p.sex === "male";
    const htM = heightCm / 100;
    const out = { bmi: weightKg / (htM * htM) };
    out.bmr = Math.round(calcBMR(p.sex, weightKg / 0.45359237, heightCm / 2.54, age));

    if (impedance > 0 && impedance < 3000) {
      const index = (heightCm * heightCm) / impedance;
      const ffm = male
        ? -10.68 + 0.65 * index + 0.26 * weightKg + 0.02 * impedance
        : -9.53 + 0.69 * index + 0.17 * weightKg + 0.02 * impedance;
      const tbw = ffm * 0.732;
      const fatKg = Math.max(weightKg - ffm, 0);
      const smm = Math.max(0.401 * index + (male ? 3.825 : 0) - 0.071 * age + 5.102, 0);
      const bone = boneMassKg(male, weightKg, ffm);
      const muscleKg = Math.max(ffm - bone, 0);
      const waterPct = (tbw / weightKg) * 100;

      out.bodyFatPct = (fatKg / weightKg) * 100;
      out.bodyFatMassLb = fatKg / 0.45359237;
      out.fatFreeWeightLb = ffm / 0.45359237;
      out.bodyWaterPct = waterPct;
      out.bodyWaterMassLb = tbw / 0.45359237;
      out.musclePct = (muscleKg / weightKg) * 100;
      out.muscleMassLb = muscleKg / 0.45359237;
      out.skeletalMusclePct = (smm / weightKg) * 100;
      out.skeletalMuscleMassLb = smm / 0.45359237;
      out.boneMassLb = bone / 0.45359237;
      out.proteinPct = clamp((ffm / weightKg) * 100 - waterPct - 5.5, 10, 24);
    }
    return out;
  }

  async function connectScale() {
    if (!scaleSupported()) return;
    try {
      setScaleStatus("Requesting device…");
      scaleUserDisconnected = false;
      scaleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SCALE_SERVICE] }]
      });
      try { localStorage.setItem("scaleDeviceId", scaleDevice.id); } catch (e) { /* private mode */ }
      scaleDevice.addEventListener("gattserverdisconnected", onScaleDisconnected);
      await openScaleGatt();
      scaleConnectBtn.textContent = "Disconnect Scale";
    } catch (err) {
      if (err && err.name === "NotFoundError") { setScaleStatus("No scale selected."); return; }
      console.error("[scale] connect failed:", err);
      setScaleStatus("Connect failed: " + (err.message || err), "err");
    }
  }

  async function openScaleGatt() {
    setScaleStatus("Connecting…");
    const server = await scaleDevice.gatt.connect();
    const service = await server.getPrimaryService(SCALE_SERVICE);
    const chars = await service.getCharacteristics();
    scaleChar = chars.find((c) => c.properties.notify || c.properties.indicate) || null;
    if (!scaleChar) throw new Error("no notify characteristic under service " + SCALE_SERVICE);
    console.log("[scale] notify characteristic:", scaleChar.uuid);
    await scaleChar.startNotifications();
    scaleChar.addEventListener("characteristicvaluechanged", (e) => handleScaleValue(e.target.value));

    scaleReconnectAttempts = 0;
    scaleArmed = true;
    setScaleStatus("Connected — step on the scale.", "ok");

    clearInterval(scalePollTimer);
    scalePollTimer = setInterval(async () => {
      if (!scaleChar) return;
      try { handleScaleValue(await scaleChar.readValue()); }
      catch (e) { /* transient read error - notifications are the primary path */ }
    }, 5000);
  }

  function onScaleDisconnected() {
    clearInterval(scalePollTimer);
    scaleChar = null;
    if (scaleUserDisconnected || !scaleDevice) { setScaleStatus("Disconnected."); return; }
    const delay = Math.min(30000, 1000 * Math.pow(2, scaleReconnectAttempts++));
    setScaleStatus("Connection lost — reconnecting…", "warn");
    setTimeout(() => {
      if (scaleUserDisconnected || !scaleDevice) return;
      openScaleGatt().catch((err) => {
        console.error("[scale] reconnect failed:", err);
        if (scaleReconnectAttempts < 6) onScaleDisconnected();
        else setScaleStatus("Reconnect failed — press Connect to retry.", "err");
      });
    }, delay);
  }

  async function handleScaleValue(dv) {
    const r = parseScalePacket(dv);
    if (!r) return;
    if (r.weightKg < 5) { scaleArmed = true; return; }   // no load / stepped off
    if (!r.stabilized || scaleImporting || !scaleArmed) return;
    scaleArmed = false;                                   // one import per weigh-in
    scaleImporting = true;
    try { await importWeighIn(r); }
    catch (err) {
      console.error("[scale] import failed:", err);
      setScaleStatus("Import failed: " + (err.message || err), "err");
    }
    finally { scaleImporting = false; }
  }

  async function importWeighIn(r) {
    setScaleStatus("Importing weigh-in…");
    const prof = readProfile();
    const body = { weightLb: round1(r.weightKg / 0.45359237) };
    let estimated = false;

    if (r.hasImpedance && prof.heightCm && prof.age && prof.sex) {
      const est = estimateBodyComposition({
        weightKg: r.weightKg, impedance: r.impedance,
        heightCm: prof.heightCm, age: prof.age, sex: prof.sex
      });
      for (const key of Object.keys(est)) {
        if (est[key] != null && isFinite(est[key])) body[key] = round1(est[key]);
      }
      estimated = true;
    } else if (prof.heightCm) {
      body.bmi = round1(r.weightKg / Math.pow(prof.heightCm / 100, 2));
    }

    const date = toLocalDateStr(new Date());
    await api(`/api/metrics/${date}`, { method: "POST", body });
    if (calState.selectedDate === date) loadMetricForDate(date);
    loadAllMetricsAndRenderCharts();

    const bf = body.bodyFatPct != null ? `, ~${body.bodyFatPct}% BF` : "";
    setScaleStatus(`Imported ${body.weightLb} lb${bf}${estimated ? " (est.)" : ""} — step off, then back on for another.`, "ok");
    scaleImportResult.hidden = false;
    scaleImportResult.textContent = `Scale → ${date}: `
      + Object.keys(body).map((k) => `${k}=${body[k]}`).join(", ")
      + (estimated ? "   — body composition estimated from bioimpedance + your profile"
                   : r.hasImpedance ? "   — add age/height/sex on the planner form for body-composition estimates"
                                    : "");
  }

  async function tryRestoreScale() {
    if (!scaleSupported() || !navigator.bluetooth.getDevices) return;
    let id = null;
    try { id = localStorage.getItem("scaleDeviceId"); } catch (e) { /* ignore */ }
    if (!id) return;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const match = devices.find((d) => d.id === id);
      if (!match) return;
      scaleDevice = match;
      scaleDevice.addEventListener("gattserverdisconnected", onScaleDisconnected);
      setScaleStatus("Reconnecting to saved scale…");
      await openScaleGatt();
      scaleConnectBtn.textContent = "Disconnect Scale";
    } catch (e) {
      setScaleStatus("Press Connect to pair your scale.");
    }
  }

  if (scaleConnectBtn) {
    if (!scaleSupported()) {
      scaleConnectBtn.disabled = true;
      setScaleStatus(
        !window.isSecureContext
          ? "Needs HTTPS (works on localhost)."
          : "Bluetooth needs Chrome or Edge on desktop / Android.",
        "err"
      );
    } else {
      scaleConnectBtn.addEventListener("click", () => {
        if (scaleDevice && scaleDevice.gatt && scaleDevice.gatt.connected) {
          scaleUserDisconnected = true;
          clearInterval(scalePollTimer);
          scaleDevice.gatt.disconnect();
          scaleConnectBtn.textContent = "Connect Bluetooth Scale";
        } else {
          connectScale();
        }
      });
    }
  }

  function loadInitialData() {
    metricsDateTag.textContent = formatDateLong(calState.selectedDate);
    loadMetricForDate(calState.selectedDate);
    loadAllMetricsAndRenderCharts();

    notesDateTag.textContent = formatDateLong(calState.selectedDate);
    loadNoteForDate(calState.selectedDate);

    refreshMonthDots();
    loadPlanForDate(calState.selectedDate);

    tryRestoreScale();
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------
  const authGate = document.getElementById("authGate");
  const authForm = document.getElementById("authForm");
  const authTitle = document.getElementById("authTitle");
  const authSub = document.getElementById("authSub");
  const authError = document.getElementById("authError");
  const authHint = document.getElementById("authHint");
  const authFlash = document.getElementById("authFlash");
  const authCardField = document.getElementById("authCardField");
  const cardError = document.getElementById("cardError");
  const authPhotoField = document.getElementById("authPhotoField");
  const avatarInput = document.getElementById("avatarInput");
  const avatarPreview = document.getElementById("avatarPreview");
  const avatarClearBtn = document.getElementById("avatarClearBtn");
  const avatarError = document.getElementById("avatarError");
  const userAvatar = document.getElementById("userAvatar");
  const headerAvatar = document.getElementById("headerAvatar");
  const dayOneBox = document.getElementById("dayOneBox");
  const goalImageBox = document.getElementById("goalImageBox");
  const goalImage = document.getElementById("goalImage");
  const photoZoom = document.getElementById("photoZoom");
  const photoZoomImg = document.getElementById("photoZoomImg");
  const photoZoomCap = document.getElementById("photoZoomCap");
  const authSubmit = document.getElementById("authSubmit");
  const authSwitchText = document.getElementById("authSwitchText");
  const authSwitchBtn = document.getElementById("authSwitchBtn");
  const authResendBtn = document.getElementById("authResendBtn");
  const authVerifyNotice = document.getElementById("authVerifyNotice");
  const authVerifyEmail = document.getElementById("authVerifyEmail");
  const authDevLink = document.getElementById("authDevLink");
  const authVerifyResendBtn = document.getElementById("authVerifyResendBtn");
  const authVerifyBackBtn = document.getElementById("authVerifyBackBtn");
  const appMain = document.getElementById("appMain");
  const userBar = document.getElementById("userBar");
  const userName = document.getElementById("userName");
  const logoutBtn = document.getElementById("logoutBtn");
  const cancelServiceBtn = document.getElementById("cancelServiceBtn");
  const serviceWarning = document.getElementById("serviceWarning");
  const cancelDialog = document.getElementById("cancelDialog");
  const cancelForm = document.getElementById("cancelForm");
  const cancelInput = document.getElementById("cancelInput");
  const cancelConfirmBtn = document.getElementById("cancelConfirmBtn");
  const cancelCloseBtn = document.getElementById("cancelCloseBtn");
  const cancelError = document.getElementById("cancelError");

  const licenseGate = document.getElementById("licenseGate");
  const licenseSub = document.getElementById("licenseSub");
  const tierGrid = document.getElementById("tierGrid");
  const addonSection = document.getElementById("addonSection");
  const addonList = document.getElementById("addonList");
  const licenseError = document.getElementById("licenseError");
  const licenseUser = document.getElementById("licenseUser");
  const licenseLogout = document.getElementById("licenseLogout");

  let authMode = "login"; // or "register"
  let appDataLoaded = false;
  let currentUser = null;
  let tiersLoaded = false;
  let selectedAddon = null;

  const AUTH_MESSAGES = {
    invalid_username: "Enter a valid email address.",
    weak_password: "Pick a stronger password — see the requirements above.",
    username_taken: "An account with that email already exists.",
    invalid_credentials: "Incorrect email or password.",
    email_not_verified: "Verify your email before logging in — check your inbox for the link.",
    card_not_validated: "Your card couldn't be validated — check the details and try again.",
    billing_unavailable: "Card processing is temporarily unavailable. Try again shortly.",
    registration_closed: "New sign-ups are temporarily closed. Check back soon.",
    missing_credentials: "Enter an email and password.",
    not_authenticated: "Your session expired — please log in again.",
    invalid_tier: "That plan isn't available — pick one of the options above.",
    invalid_addon: "That additional service isn't available — pick another option."
  };

  // -------------------------------------------------------------------------
  // Registration card-on-file (Stripe). A SetupIntent is confirmed with the
  // card in Stripe's iframe; only its id is sent to /register, which validates
  // it and saves the card. Nothing is charged.
  // -------------------------------------------------------------------------
  let stripe = null;
  let stripeElements = null;
  let cardClientSecret = null;
  let billingEnabled = false;
  let cardMounted = false;
  let billingProbed = false;
  let cardBlockedReason = null; // set when a card is required but can't be collected here

  function showCardBlocked(msg) {
    cardBlockedReason = msg;
    authCardField.hidden = false;
    document.getElementById("cardElement").innerHTML = "";
    cardError.textContent = msg;
    cardError.hidden = false;
  }

  async function initCardField() {
    if (!authCardField) return;
    if (!billingProbed) {
      billingProbed = true;
      try {
        const cfg = await (await fetch("/api/billing/config")).json();
        if (cfg.enabled && cfg.publishableKey) {
          if (!window.isSecureContext) {
            showCardBlocked("Sign-up needs a secure (HTTPS) connection to take card details.");
            return;
          }
          if (!window.Stripe) {
            showCardBlocked("Couldn't load the payment library — disable blockers for js.stripe.com and reload.");
            return;
          }
          billingEnabled = true;
          stripe = window.Stripe(cfg.publishableKey);
        }
      } catch (e) {
        console.error("billing config failed:", e);
      }
    }
    if (cardBlockedReason) { showCardBlocked(cardBlockedReason); return; }
    if (!billingEnabled) { authCardField.hidden = true; return; }
    authCardField.hidden = false;
    if (cardMounted) return;
    try {
      const si = await (await fetch("/api/billing/setup-intent", { method: "POST" })).json();
      if (!si.clientSecret) { showCardBlocked("Card processing is unavailable right now — try again shortly."); return; }
      cardClientSecret = si.clientSecret;
      stripeElements = stripe.elements({ clientSecret: cardClientSecret, appearance: { theme: "night" } });
      const paymentEl = stripeElements.create("payment", { layout: "tabs" });
      paymentEl.on("loaderror", (ev) => {
        showCardBlocked((ev && ev.error && ev.error.message) ||
          "The card form failed to load. Reload the page and try again.");
      });
      paymentEl.mount("#cardElement");
      cardMounted = true;
    } catch (e) {
      console.error("card element init failed:", e);
      billingEnabled = false;
      authCardField.hidden = true;
    }
  }

  function resetCardField() {
    if (stripeElements) { try { stripeElements.getElement("payment").unmount(); } catch (e) { /* ignore */ } }
    stripeElements = null;
    cardClientSecret = null;
    cardMounted = false;
  }

  // Confirms the SetupIntent with the entered card. Resolves to the setup
  // intent id on success, or null (with cardError shown) on failure. The
  // SetupIntent is created with allow_redirects:"never", so any 3-D Secure
  // challenge runs inline and this never navigates away.
  async function confirmCard() {
    cardError.hidden = true;
    if (!stripe || !stripeElements) return null;
    const { error: submitErr } = await stripeElements.submit();
    if (submitErr) { cardError.textContent = submitErr.message; cardError.hidden = false; return null; }
    const { error, setupIntent } = await stripe.confirmSetup({
      elements: stripeElements,
      clientSecret: cardClientSecret,
      redirect: "if_required"
    });
    if (error) {
      cardError.textContent = error.message || "Card could not be verified.";
      cardError.hidden = false;
      return null;
    }
    return setupIntent && setupIntent.status === "succeeded" ? setupIntent.id : null;
  }

  // -------------------------------------------------------------------------
  // Registration photo -> avatar. Resized to a 256px square JPEG in the browser
  // and sent as a data URI with the register request.
  // -------------------------------------------------------------------------
  let avatarDataUri = null;
  const AVATAR_SIZE = 512;   // stored size; the header shows a small thumb, hover enlarges

  function resizeToAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) { reject(new Error("Choose an image file.")); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = AVATAR_SIZE;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image couldn't be read.")); };
      img.src = url;
    });
  }

  function clearAvatarSelection() {
    avatarDataUri = null;
    avatarInput.value = "";
    avatarPreview.hidden = true;
    avatarPreview.removeAttribute("src");
    avatarClearBtn.hidden = true;
    avatarError.hidden = true;
  }

  if (avatarInput) {
    avatarInput.addEventListener("change", async () => {
      const file = avatarInput.files[0];
      if (!file) return;
      avatarError.hidden = true;
      try {
        avatarDataUri = await resizeToAvatar(file);
        avatarPreview.src = avatarDataUri;
        avatarPreview.hidden = false;
        avatarClearBtn.hidden = false;
      } catch (err) {
        clearAvatarSelection();
        avatarError.textContent = err.message || "Couldn't use that image.";
        avatarError.hidden = false;
      }
    });
    avatarClearBtn.addEventListener("click", clearAvatarSelection);
  }

  // Points the user-bar avatar and the "Day One" header photo at the signed-in
  // user's uploaded photo, or hides them when there's none.
  function applyAvatar(user) {
    const show = !!(user && user.hasAvatar);
    if (show) {
      const src = "/api/avatar?t=" + Date.now();
      if (userAvatar) { userAvatar.src = src; userAvatar.hidden = false; }
      if (headerAvatar) headerAvatar.src = src;
      if (dayOneBox) dayOneBox.hidden = false;
    } else {
      if (userAvatar) { userAvatar.hidden = true; userAvatar.removeAttribute("src"); }
      if (headerAvatar) headerAvatar.removeAttribute("src");
      if (dayOneBox) dayOneBox.hidden = true;
    }
  }

  // The AI "goal physique" portrait, shown bottom-right of the header.
  function applyGoalImage(user) {
    if (!goalImageBox) return;
    if (user && user.hasGoalImage) {
      goalImage.src = "/api/goal-image?t=" + Date.now();
      goalImageBox.hidden = false;
    } else {
      goalImageBox.hidden = true;
      goalImage.removeAttribute("src");
    }
  }

  // Hover / focus a header photo -> a larger, full-resolution popup below it.
  function positionPhotoZoom(fig) {
    const r = fig.getBoundingClientRect();
    const zw = photoZoom.offsetWidth || 340;
    let left = r.left + r.width / 2 - zw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - zw - 12));
    photoZoom.style.left = left + "px";
    photoZoom.style.top = Math.round(r.bottom + 10) + "px";
  }
  function showPhotoZoom(fig) {
    const img = fig.querySelector(".header-photo-img");
    if (!img || !img.getAttribute("src")) return;
    if (photoZoomImg.src !== img.src) photoZoomImg.src = img.src;
    photoZoomCap.textContent = fig.querySelector("figcaption").textContent;
    positionPhotoZoom(fig);
    photoZoom.classList.add("show");
  }
  function hidePhotoZoom() {
    photoZoom.classList.remove("show");
  }
  if (photoZoom) {
    document.querySelectorAll(".header-photo").forEach((fig) => {
      const img = fig.querySelector(".header-photo-img");
      if (img) img.tabIndex = 0;
      fig.addEventListener("mouseenter", () => showPhotoZoom(fig));
      fig.addEventListener("mouseleave", hidePhotoZoom);
      fig.addEventListener("focusin", () => showPhotoZoom(fig));
      fig.addEventListener("focusout", hidePhotoZoom);
    });
    window.addEventListener("scroll", hidePhotoZoom, { passive: true });
    window.addEventListener("resize", hidePhotoZoom);
  }

  // Fired after the goal form is saved. Regenerates only when the goal changed
  // (the server decides). Best-effort - failures are silent.
  async function refreshGoalImage(inputs) {
    if (!goalImageBox) return;
    goalImageBox.hidden = false;
    goalImageBox.classList.add("generating");
    try {
      const r = await api("/api/goal-image", {
        method: "POST",
        body: { sex: inputs.sex, goal: inputs.goal, experience: inputs.experience, days: inputs.days }
      });
      if (r && (r.status === "generated" || r.status === "current")) {
        goalImage.src = "/api/goal-image?t=" + Date.now();
      } else {
        goalImageBox.hidden = true;   // disabled / no_photo
      }
    } catch (e) {
      goalImageBox.hidden = !goalImage.getAttribute("src");
    } finally {
      goalImageBox.classList.remove("generating");
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    authError.hidden = true;
    authResendBtn.hidden = true;
    authVerifyNotice.hidden = true;
    authForm.hidden = false;
    authForm.parentElement.querySelector(".auth-switch").hidden = false;
    const registering = mode === "register";
    authTitle.hidden = false;
    authTitle.textContent = registering ? "Create account" : "Log in";
    authSub.hidden = false;
    authSub.textContent = registering
      ? "Sign up with your email and a password to start your own Levrone Protocol log."
      : "Log in to your Levrone Protocol account.";
    authSubmit.textContent = registering ? "Create account" : "Log in";
    authSwitchText.textContent = registering ? "Already have an account?" : "Need an account?";
    authSwitchBtn.textContent = registering ? "Log in" : "Register";
    authForm.password.autocomplete = registering ? "new-password" : "current-password";
    authHint.hidden = !registering;
    if (authPhotoField) authPhotoField.hidden = !registering;
    if (registering) initCardField();
    else if (authCardField) authCardField.hidden = true;
  }

  // After registration (or "resend"), swap the form for a "check your email"
  // panel. `devLink` is only present in non-production when SES isn't wired up.
  function showVerifyNotice(email, devLink) {
    authError.hidden = true;
    authFlash.hidden = true;
    authResendBtn.hidden = true;
    authTitle.hidden = true;
    authSub.hidden = true;
    authForm.hidden = true;
    authForm.parentElement.querySelector(".auth-switch").hidden = true;
    authVerifyEmail.textContent = email;
    authVerifyNotice.dataset.email = email;
    if (devLink) {
      authDevLink.hidden = false;
      authDevLink.innerHTML = 'Dev mode (email not sent): <a href="' + devLink + '">verify now</a>';
    } else {
      authDevLink.hidden = true;
    }
    authVerifyNotice.hidden = false;
  }

  async function resendVerification(email, statusEl) {
    if (!email) return;
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email })
      });
      const data = await res.json().catch(() => ({}));
      if (data.devLink) {
        authDevLink.hidden = false;
        authDevLink.innerHTML = 'Dev mode (email not sent): <a href="' + data.devLink + '">verify now</a>';
      }
      if (statusEl) {
        statusEl.textContent = "Sent — check your inbox.";
        statusEl.hidden = false;
      }
    } catch (err) {
      console.error("Resend failed:", err);
      if (statusEl) { statusEl.textContent = "Could not resend. Try again."; statusEl.hidden = false; }
    }
  }

  function showAuthGate() {
    userBar.hidden = true;
    appMain.hidden = true;
    licenseGate.hidden = true;
    authGate.hidden = false;
    authForm.username.focus();
  }

  function showApp(user, license) {
    currentUser = user;
    authGate.hidden = true;
    licenseGate.hidden = true;
    appMain.hidden = false;
    userBar.hidden = false;
    userName.textContent = user.username;
    applyAvatar(user);
    applyGoalImage(user);
    applyServiceStatus(license);
    if (!appDataLoaded) {
      appDataLoaded = true;
      loadInitialData();
    }
  }

  // Routes to the app when the account is licensed, or to the plan picker when
  // it isn't (a fresh registration, or a login on an unlicensed account). A
  // canceled license still routes into the app - just read-only.
  function routeAfterAuth(user, license) {
    if (license && license.tier) {
      showApp(user, license);
    } else {
      showLicenseGate(user);
    }
  }

  // -------------------------------------------------------------------------
  // Service cancellation / read-only mode
  // -------------------------------------------------------------------------
  let serviceCanceled = false;

  // Puts the app in read-only mode: disables every input / action button under
  // #appMain and blocks pointer events on its panels (belt-and-braces for any
  // controls added later). The warning banner and user bar stay live. This is
  // a one-way switch in the GUI, so there's nothing to undo.
  function setAppReadOnly(on) {
    if (!on) return;
    appMain.classList.add("app-readonly");
    appMain.querySelectorAll("input, select, textarea, button").forEach((el) => {
      if (el.closest("#serviceWarning")) return;
      el.disabled = true;
    });
  }

  function applyServiceStatus(license) {
    const canceled = !!license && license.status === "canceled";
    serviceCanceled = canceled;
    if (serviceWarning) serviceWarning.hidden = !canceled;
    if (cancelServiceBtn) cancelServiceBtn.hidden = canceled;
    setAppReadOnly(canceled);
  }

  if (cancelServiceBtn) {
    cancelServiceBtn.addEventListener("click", () => {
      cancelError.hidden = true;
      cancelInput.value = "";
      cancelConfirmBtn.disabled = true;
      cancelDialog.hidden = false;
      cancelInput.focus();
    });
    cancelCloseBtn.addEventListener("click", () => { cancelDialog.hidden = true; });
    cancelInput.addEventListener("input", () => {
      cancelConfirmBtn.disabled = cancelInput.value.trim().toLowerCase() !== "cancel";
    });
    cancelForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (cancelInput.value.trim().toLowerCase() !== "cancel") return;
      cancelConfirmBtn.disabled = true;
      cancelError.hidden = true;
      try {
        const data = await api("/api/license/cancel", {
          method: "POST",
          body: { confirm: cancelInput.value.trim() }
        });
        cancelDialog.hidden = true;
        applyServiceStatus(data.license);
        const n = data.subscriptionsCanceled || 0;
        serviceWarning.querySelector(".service-warning-detail").textContent =
          n > 0
            ? `${n} recurring payment${n === 1 ? "" : "s"} stopped. Your logged data is kept and stays viewable.`
            : "Your logged data is kept and stays viewable.";
      } catch (err) {
        cancelError.textContent =
          err.message === "already_canceled"
            ? "Your service is already canceled."
            : "Could not cancel right now. Try again.";
        cancelError.hidden = false;
        cancelConfirmBtn.disabled = false;
      }
    });
  }

  const TIER_MESSAGE = "Your account isn't licensed yet. Pick a plan to unlock The Levrone Protocol.";

  async function showLicenseGate(user) {
    currentUser = user;
    appDataLoaded = false;
    authGate.hidden = true;
    appMain.hidden = true;
    userBar.hidden = true;
    licenseError.hidden = true;
    licenseSub.textContent = TIER_MESSAGE;
    licenseUser.textContent = user ? user.username : "";
    licenseGate.hidden = false;
    await renderTiers();
  }

  async function renderTiers() {
    if (tiersLoaded) return;
    try {
      const res = await fetch("/api/license/tiers");
      const data = await res.json();
      tierGrid.innerHTML = "";
      (data.tiers || []).forEach((tier) => {
        const card = document.createElement("div");
        card.className = `tier-card tier-${tier.id}` + (tier.badge ? " tier-featured" : "");
        const features = (tier.features || [])
          .map((f) => `<li>${f}</li>`)
          .join("");
        const badge = tier.badge ? `<div class="tier-badge">${tier.badge}</div>` : "";
        card.innerHTML = `
          <div class="tier-name"><span class="tier-name-text">${tier.name}</span>${badge}</div>
          <div class="tier-price"><span class="tier-amount">${tier.price}</span><span class="tier-period">per ${tier.period}</span></div>
          <p class="tier-blurb">${tier.blurb || ""}</p>
          <ul class="tier-features">${features}</ul>
          <button type="button" class="btn-primary tier-select" data-tier="${tier.id}">Choose ${tier.name}</button>
        `;
        card.querySelector(".tier-select").addEventListener("click", () => selectTier(tier.id));
        tierGrid.appendChild(card);
      });
      renderAddons(data.services || []);
      tiersLoaded = true;
    } catch (err) {
      console.error("Failed to load plans:", err);
      licenseError.textContent = "Could not load the plans. Refresh and try again.";
      licenseError.hidden = false;
    }
  }

  // Renders the optional "Additional Services" list as a single-select group.
  // Clicking the selected option again clears it.
  function renderAddons(services) {
    addonList.innerHTML = "";
    if (services.length === 0) {
      addonSection.hidden = true;
      return;
    }
    const metalClasses = ["tier-bronze", "tier-silver", "tier-gold"];
    services.forEach((svc, i) => {
      const row = document.createElement("button");
      row.type = "button";
      const metalClass = svc.metal ? `tier-${svc.metal}` : metalClasses[i % metalClasses.length];
      row.className = `addon-option ${metalClass}`;
      row.dataset.addon = svc.id;
      row.setAttribute("aria-pressed", "false");
      const price = svc.priceLabel || (svc.price && svc.period ? `${svc.price} / ${svc.period}` : "");
      const priceEl = price ? `<span class="addon-price">${price}</span>` : "";
      row.innerHTML = `${priceEl}<span class="addon-row"><span class="addon-check" aria-hidden="true"></span><span class="addon-label">${svc.label}</span></span>`;
      row.addEventListener("click", () => {
        selectedAddon = selectedAddon === svc.id ? null : svc.id;
        addonList.querySelectorAll(".addon-option").forEach((el) => {
          const on = el.dataset.addon === selectedAddon;
          el.classList.toggle("selected", on);
          el.setAttribute("aria-pressed", String(on));
        });
      });
      addonList.appendChild(row);
    });
    addonSection.hidden = false;
  }

  async function selectTier(tierId) {
    licenseError.hidden = true;
    const buttons = tierGrid.querySelectorAll(".tier-select");
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierId, addon: selectedAddon })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        licenseError.textContent = AUTH_MESSAGES[data.error] || "Could not activate that plan. Try again.";
        licenseError.hidden = false;
        return;
      }
      if (currentUser) showApp(currentUser);
    } catch (err) {
      console.error("Failed to select plan:", err);
      licenseError.textContent = "Could not reach the server. Try again.";
      licenseError.hidden = false;
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  function handleLicenseRequired() {
    if (!licenseGate.hidden) return;
    showLicenseGate(currentUser);
  }

  licenseLogout.addEventListener("click", () => logout());

  function handleUnauthorized() {
    if (!authGate.hidden) return;
    appDataLoaded = false;
    currentUser = null;
    authForm.reset();
    setAuthMode("login");
    authError.textContent = AUTH_MESSAGES.not_authenticated;
    authError.hidden = false;
    showAuthGate();
  }

  authSwitchBtn.addEventListener("click", () => {
    authFlash.hidden = true;
    setAuthMode(authMode === "login" ? "register" : "login");
    authForm.username.focus();
  });

  authResendBtn.addEventListener("click", () => resendVerification(authResendBtn.dataset.email, authFlash));
  authVerifyResendBtn.addEventListener("click", () =>
    resendVerification(authVerifyNotice.dataset.email, authDevLink));
  authVerifyBackBtn.addEventListener("click", () => {
    setAuthMode("login");
    authForm.username.focus();
  });

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.hidden = true;
    authResendBtn.hidden = true;
    const username = authForm.username.value.trim();
    const password = authForm.password.value;
    if (!username || !password) return;

    const registering = authMode === "register";
    if (registering && cardBlockedReason) {
      authError.textContent = cardBlockedReason;
      authError.hidden = false;
      return;
    }

    authSubmit.disabled = true;
    const endpoint = registering ? "/api/auth/register" : "/api/auth/login";
    const payload = { username, password };
    if (registering && avatarDataUri) payload.avatar = avatarDataUri;
    try {
      if (registering && billingEnabled) {
        const setupIntentId = await confirmCard();
        if (!setupIntentId) { authSubmit.disabled = false; return; }
        payload.setupIntentId = setupIntentId;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        authError.textContent = data.message || AUTH_MESSAGES[data.error] || "Something went wrong. Try again.";
        authError.hidden = false;
        if (data.error === "email_not_verified") {
          authResendBtn.dataset.email = data.email || username;
          authResendBtn.hidden = false;
        }
        return;
      }
      if (data.status === "verification_sent") {
        authForm.reset();
        resetCardField();
        clearAvatarSelection();
        showVerifyNotice(data.email, data.devLink);
        return;
      }
      authForm.reset();
      setAuthMode("login");
      routeAfterAuth(data.user, data.license);
    } catch (err) {
      console.error("Auth request failed:", err);
      authError.textContent = "Could not reach the server. Try again.";
      authError.hidden = false;
    } finally {
      authSubmit.disabled = false;
    }
  });

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout failed:", err);
    }
    appDataLoaded = false;
    currentUser = null;
    authForm.reset();
    setAuthMode("login");
    showAuthGate();
  }

  logoutBtn.addEventListener("click", logout);

  async function bootstrap() {
    setAuthMode("login");

    // The verify link redirects here with ?verified=1 and a fresh session.
    const justVerified = new URLSearchParams(location.search).has("verified");
    if (justVerified) {
      history.replaceState(null, "", location.pathname);
    }

    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        routeAfterAuth(data.user, data.license);
        return;
      }
    } catch (err) {
      console.error("Session check failed:", err);
    }
    if (justVerified) {
      authFlash.textContent = "Email verified. Log in to continue.";
      authFlash.hidden = false;
    }
    showAuthGate();
  }

  bootstrap();
})();
