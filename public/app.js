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
    { key: "musclePct", label: "Muscle Mass", unit: "%", color: "#5cb85c" },
    { key: "skeletalMusclePct", label: "Skeletal Muscle", unit: "%", color: "#a3b93c" },
    { key: "boneMassLb", label: "Bone Mass", unit: " lbs", color: "#e08a3c" },
    { key: "bmi", label: "BMI", unit: "", color: "#9b7fd4" },
    { key: "bmr", label: "BMR", unit: " kcal", color: "#d46fa2" },
    { key: "visceralFat", label: "Visceral Fat", unit: "", color: "#7a93b0" },
    { key: "metabolicAge", label: "Metabolic Age", unit: " yrs", color: "#b08d57" },
    { key: "proteinPct", label: "Protein", unit: "%", color: "#8bc34a" },
    { key: "subcutaneousFatPct", label: "Subcutaneous Fat", unit: "%", color: "#e08080" }
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

  metricsDateTag.textContent = formatDateLong(calState.selectedDate);
  loadMetricForDate(calState.selectedDate);
  loadAllMetricsAndRenderCharts();

  notesDateTag.textContent = formatDateLong(calState.selectedDate);
  loadNoteForDate(calState.selectedDate);

  refreshMonthDots();
  loadPlanForDate(calState.selectedDate);
})();
