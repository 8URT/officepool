const POOL_URL = "data/pool.json";
const GITHUB_REPO = "8URT/officepool";
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/main`;
const IS_LOCAL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.protocol === "file:";
const STORED_SCORES_URL = IS_LOCAL ? "data/scores.json" : `${GITHUB_RAW_BASE}/data/scores.json`;
const SNAPSHOTS_URL = IS_LOCAL ? "data/rank-snapshots.json" : `${GITHUB_RAW_BASE}/data/rank-snapshots.json`;
const SCORES_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const REFRESH_MS = 2 * 60 * 1000;
const LIVE_REFRESH_MS = 60 * 1000;
const ARROW_MATCH_LOOKBACK = 5;
const CALENDAR_PILL_COUNT = 10;
const THEME_KEY = "wc-pool-theme";
const RANKING_TAB_KEY = "wc-pool-ranking-tab";
const MUT = "Indian/Mauritius";
// Kickoff times in pool.json are stored in UTC (FIFA schedule).
const POOL_TIME_SOURCE = "UTC";

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const mutDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MUT,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const mutTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MUT,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const mutClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MUT,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const TEAM_ALIASES = {
  "Korea Republic": "South Korea",
  "United States": "USA",
  "Bosnia and Herzegovina": "Bosnia & Herzegovina",
  Turkey: "Turkiye",
  Türkiye: "Turkiye",
  "Czech Republic": "Czechia",
  Czechia: "Czechia",
};

const els = {
  rankingList: document.getElementById("rankingList"),
  matchFeed: document.getElementById("matchFeed"),
  nextFeed: document.getElementById("nextFeed"),
  statusText: document.getElementById("statusText"),
  lastUpdate: document.getElementById("lastUpdate"),
  liveDot: document.getElementById("liveDot"),
  playedChip: document.getElementById("playedChip"),
  refreshBtn: document.getElementById("refreshBtn"),
  pullResultsBtn: document.getElementById("pullResultsBtn"),
  themeBtn: document.getElementById("themeBtn"),
  toast: document.getElementById("toast"),
  playerSheet: document.getElementById("playerSheet"),
  playerSheetBackdrop: document.getElementById("playerSheetBackdrop"),
  playerSheetClose: document.getElementById("playerSheetClose"),
  playerSheetTitle: document.getElementById("playerSheetTitle"),
  playerSheetSub: document.getElementById("playerSheetSub"),
  playerSheetStats: document.getElementById("playerSheetStats"),
  playerSheetBody: document.getElementById("playerSheetBody"),
  playerTabs: document.querySelectorAll(".player-tab"),
  calendarPill: document.getElementById("calendarPill"),
  resultsPill: document.getElementById("resultsPill"),
  infoSheet: document.getElementById("infoSheet"),
  infoSheetBackdrop: document.getElementById("infoSheetBackdrop"),
  infoSheetClose: document.getElementById("infoSheetClose"),
  infoSheetTitle: document.getElementById("infoSheetTitle"),
  infoSheetSub: document.getElementById("infoSheetSub"),
  infoSheetBody: document.getElementById("infoSheetBody"),
  matchSpotlight: document.getElementById("matchSpotlight"),
  matchSpotlightPanel: document.getElementById("matchSpotlightPanel"),
  virtualTab: document.getElementById("virtualTab"),
  liveTab: document.getElementById("liveTab"),
  rankHint: document.getElementById("rankHint"),
};

let poolData = null;
let lastSnapshotsScoresVersion = null;
let storedScoresMeta = null;
let rankSnapshots = null;
let refreshTimer = null;
let liveClockTimer = null;
let activeRankingTab = "virtual";
let hadLiveMatches = false;
let prevSpotlightScores = new Map();
let appState = {
  standings: [],
  liveStandings: [],
  scoredMatches: [],
  finishedMatches: [],
  liveMatches: [],
  upcomingMatches: [],
  rankEvolution: {},
  liveRankEvolution: {},
};
let activePlayer = null;
let activePlayerTab = "played";
let activeInfoSheet = null;

function normalizeTeam(name) {
  return TEAM_ALIASES[name] || name;
}

function formatDisplayName(name) {
  if (!name) return "";
  const lower = String(name).toLocaleLowerCase("en");
  if (!lower) return "";
  return lower.charAt(0).toLocaleUpperCase("en") + lower.slice(1);
}

function normalizeKey(home, away) {
  const teams = [normalizeTeam(home), normalizeTeam(away)].sort();
  return `${teams[0]}|${teams[1]}`;
}

function parseTimeParts(timeStr) {
  if (!timeStr) return [0, 0];
  const [hours, minutes] = String(timeStr).split(":");
  return [parseInt(hours, 10) || 0, parseInt(minutes, 10) || 0];
}

function poolTimeToDate(year, monthIndex, day, hour, minute) {
  return new Date(Date.UTC(year, monthIndex, day, hour, minute));
}

function parseMatchDateTime(dateStr, timeStr) {
  if (!dateStr) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split("-").map((part) => parseInt(part, 10));
    const [hour, minute] = parseTimeParts(timeStr);
    return poolTimeToDate(year, month - 1, day, hour, minute);
  }

  const cleaned = String(dateStr).replace(",", "").trim();
  const parts = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (!parts) return null;

  const monthIndex = MONTHS[parts[1].slice(0, 3)];
  if (monthIndex == null) return null;

  const [hour, minute] = parseTimeParts(timeStr);
  return poolTimeToDate(parseInt(parts[3], 10), monthIndex, parseInt(parts[2], 10), hour, minute);
}

function getMatchWhen(match) {
  if (match.when instanceof Date && !Number.isNaN(match.when.getTime())) return match.when;
  return parseMatchDateTime(match.date, match.time);
}

function formatTime(isoDate) {
  if (!isoDate) return "";
  return `${mutClockFormatter.format(isoDate)} MUT`;
}

function formatMatchWhen(match, { includeMut = true } = {}) {
  const when = getMatchWhen(match);
  if (!when) return match.date || "";
  const datePart = mutDateFormatter.format(when);
  const timePart = mutTimeFormatter.format(when);
  const suffix = includeMut ? " MUT" : "";
  return `${datePart} · ${timePart}${suffix}`;
}

function formatMutDateOnly(match) {
  const when = getMatchWhen(match);
  if (!when) return match.date || "";
  return mutDateFormatter.format(when);
}

function formatMutTimeOnly(match) {
  const when = getMatchWhen(match);
  if (!when) return "";
  return mutTimeFormatter.format(when);
}

function renderCalendarRow(match) {
  return `
    <article class="calendar-row">
      <span class="calendar-time">${formatMutTimeOnly(match)}</span>
      <div class="calendar-teams">${match.home} <span class="calendar-vs">vs</span> ${match.away}</div>
    </article>
  `;
}

function renderCalendarGrouped(matches) {
  const groups = new Map();
  for (const match of matches) {
    const day = formatMutDateOnly(match);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(match);
  }

  return [...groups.entries()]
    .map(
      ([day, dayMatches]) => `
        <section class="calendar-day">
          <h3 class="calendar-day-head">${day}</h3>
          <div class="calendar-day-list">
            ${dayMatches.map(renderCalendarRow).join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function buildParticipantStats(pool, matches) {
  return pool.participants.map((name) => {
    let points = 0;
    let exactHits = 0;
    const predictions = pool.predictions[name] || {};

    for (const match of matches) {
      const prediction = getPrediction(predictions, match.id);
      if (isExactPrediction(prediction, match.result)) {
        points += pool.scoring?.exactScore ?? 1;
        exactHits += 1;
      }
    }

    return { name, points, exactHits };
  });
}

function sortAndRankStandings(standings) {
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.exactHits !== a.exactHits) return b.exactHits - a.exactHits;
    return a.name.localeCompare(b.name);
  });
  return assignRanks(standings);
}

function buildRankEvolution(pool, finishedMatches) {
  const chronological = [...finishedMatches].sort((a, b) => (a.when || 0) - (b.when || 0));
  const beforeWindow =
    chronological.length > ARROW_MATCH_LOOKBACK
      ? chronological.slice(0, chronological.length - ARROW_MATCH_LOOKBACK)
      : [];
  const windowMatches = chronological.slice(-ARROW_MATCH_LOOKBACK);

  const baselineStandings = sortAndRankStandings(buildParticipantStats(pool, beforeWindow));
  const baselineRanks = Object.fromEntries(baselineStandings.map((entry) => [entry.name, entry.rank]));

  const evolution = {};
  for (const name of pool.participants) {
    const predictions = pool.predictions[name] || {};
    const results = [];

    for (let i = 0; i < ARROW_MATCH_LOOKBACK; i += 1) {
      if (i >= windowMatches.length) {
        results.push({ type: "pending", match: null, label: "" });
        continue;
      }

      const match = windowMatches[i];
      const prediction = getPrediction(predictions, match.id);
      const exact = isExactPrediction(prediction, match.result);
      const label = `${match.home} ${match.result.scoreHome}-${match.result.scoreAway} ${match.away}`;

      results.push({
        type: exact ? "win" : "loss",
        match,
        label,
      });
    }

    evolution[name] = { baselineRank: baselineRanks[name] ?? null, results };
  }

  return evolution;
}

function buildLiveRankEvolution(pool, finishedMatches, liveMatches, snapshots) {
  const chronologicalFinished = [...finishedMatches].sort((a, b) => (a.when || 0) - (b.when || 0));
  const primaryLive = liveMatches.length
    ? [...liveMatches].sort((a, b) => (b.when || 0) - (a.when || 0))[0]
    : null;
  const primaryKey = primaryLive ? normalizeKey(primaryLive.home, primaryLive.away) : null;
  const snapshot = primaryKey ? snapshots?.snapshots?.[primaryKey] : null;

  const liveSlotCount = Math.min(liveMatches.length, ARROW_MATCH_LOOKBACK);
  const finishedSlotCount = Math.max(0, ARROW_MATCH_LOOKBACK - liveSlotCount);
  const recentFinished = chronologicalFinished.slice(-finishedSlotCount);

  const evolution = {};
  for (const name of pool.participants) {
    const predictions = pool.predictions[name] || {};
    const results = [];

    for (const match of recentFinished) {
      const prediction = getPrediction(predictions, match.id);
      const exact = isExactPrediction(prediction, match.result);
      const label = `${match.home} ${match.result.scoreHome}-${match.result.scoreAway} ${match.away}`;
      results.push({ type: exact ? "win" : "loss", match, label });
    }

    for (let i = 0; i < liveSlotCount; i += 1) {
      const match = liveMatches[i];
      const label = match
        ? `${match.home} ${match.result.scoreHome}-${match.result.scoreAway} ${match.away} · in play`
        : "In play";
      results.push({ type: "live-pending", match, label });
    }

    while (results.length < ARROW_MATCH_LOOKBACK) {
      results.push({ type: "pending", match: null, label: "" });
    }

    evolution[name] = {
      baselineRank: snapshot?.ranks?.[name] ?? null,
      results,
    };
  }

  return evolution;
}

function renderRankMove(currentRank, baselineRank) {
  if (baselineRank == null || currentRank == null) return "";

  if (currentRank < baselineRank) {
    return `<span class="rank-move up" title="Up from #${baselineRank} to #${currentRank}">▲</span>`;
  }
  if (currentRank > baselineRank) {
    return `<span class="rank-move down" title="Down from #${baselineRank} to #${currentRank}">▼</span>`;
  }
  return `<span class="rank-move same" title="Unchanged at #${currentRank}"><span class="rank-move-dot"></span></span>`;
}

function renderRankBaseline(baselineRank, { mode = "virtual" } = {}) {
  const title =
    mode === "live"
      ? "Rank at kickoff of live match"
      : `Rank before last ${ARROW_MATCH_LOOKBACK} results`;
  return baselineRank != null
    ? `<span class="rank-baseline" title="${title}">#${baselineRank}</span>`
    : `<span class="rank-baseline muted">—</span>`;
}

function renderRankResults(results, { mode = "virtual" } = {}) {
  const resultsHtml = results
    .map((step, index) => {
      if (step.type === "pending") {
        return `<span class="evo-result pending" title="Match ${index + 1} not played yet">·</span>`;
      }

      if (step.type === "live-pending") {
        const title = step.label || `Match ${index + 1} in play`;
        return `<strong class="evo-result live-pending" title="${title}">?</strong>`;
      }

      const title = step.label
        ? `Result ${index + 1}: ${step.label} · ${step.type === "win" ? "Exact score (+1 pt)" : "Miss"}`
        : `Result ${index + 1}`;

      if (step.type === "win") {
        return `<strong class="evo-result win" title="${title}">W</strong>`;
      }
      return `<strong class="evo-result loss" title="${title}">L</strong>`;
    })
    .join("");

  const ariaLabel =
    mode === "live"
      ? `Last results and live slots`
      : `Last ${ARROW_MATCH_LOOKBACK} results win or loss`;

  return `
    <div class="rank-evolution">
      <div class="rank-results" aria-label="${ariaLabel}">${resultsHtml}</div>
    </div>
  `;
}

function formatLiveMinute(result) {
  if (!result?.isLive) return result?.statusText || "";

  const statusText = result.statusText || "";
  if (statusText === "HT" || statusText.endsWith(" HT")) return statusText || "HT";

  const baseMinute = result.minute;
  if (baseMinute == null) return statusText || "Live";

  const syncedAt = result.syncedAt ? new Date(result.syncedAt) : null;
  if (!syncedAt || Number.isNaN(syncedAt.getTime())) {
    return statusText || `${baseMinute}'`;
  }

  const extra = Math.floor((Date.now() - syncedAt.getTime()) / 60000);
  if (extra <= 0) return `${baseMinute}'`;

  return `${Math.min(baseMinute + extra, 120)}'`;
}

function buildScoreMapFromStored(storedData) {
  const map = new Map();
  for (const match of storedData?.matches || []) {
    const isLive = Boolean(match.isLive) || match.status === "live";
    if (!isLive && (match.scoreHome == null || match.scoreAway == null)) continue;

    const key = match.key || normalizeKey(match.home, match.away);
    map.set(key, {
      home: match.home,
      away: match.away,
      scoreHome: match.scoreHome ?? 0,
      scoreAway: match.scoreAway ?? 0,
      status: match.status || (isLive ? "live" : "finished"),
      isLive,
      minute: match.minute ?? null,
      statusText: match.statusText || (match.minute != null ? `${match.minute}'` : "Live"),
      syncedAt: match.syncedAt || storedData?.updatedAt || null,
      date: match.date,
      round: match.round,
      group: match.group,
      source: match.source || "stored",
    });
  }
  return map;
}

function mergeScoreMaps(baseMap, overlayMap) {
  const merged = new Map(baseMap);
  for (const [key, value] of overlayMap) {
    const base = merged.get(key);
    // Don't let a stale stored "live" row hide a confirmed full-time result.
    if (value.isLive && base && !base.isLive) continue;
    merged.set(key, value);
  }
  return merged;
}

function normalizeLiveResult(result) {
  if (!result?.isLive) return result;

  const syncedAt = result.syncedAt ? new Date(result.syncedAt).getTime() : NaN;
  if (Number.isNaN(syncedAt)) return result;

  const ageMs = Date.now() - syncedAt;
  const minute = result.minute ?? 0;
  const looksFinished = minute >= 70 && ageMs >= 10 * 60 * 1000;
  const looksAbandoned = ageMs >= 45 * 60 * 1000;

  if (!looksFinished && !looksAbandoned) return result;

  return {
    ...result,
    isLive: false,
    status: "finished",
    minute: null,
    statusText: null,
  };
}

function buildScoreMapFromOpenfootball(apiMatches) {
  const map = new Map();
  for (const match of apiMatches) {
    const ft = match.score?.ft;
    if (!ft || ft.length !== 2 || ft[0] == null || ft[1] == null) continue;

    const home = match.team1;
    const away = match.team2;
    const key = normalizeKey(home, away);
    map.set(key, {
      home,
      away,
      scoreHome: ft[0],
      scoreAway: ft[1],
      status: "finished",
      isLive: false,
      date: match.date,
      round: match.round,
      group: match.group,
      source: "openfootball",
    });
  }
  return map;
}

function resolveMatchResult(poolMatch, scoreMap) {
  const key = normalizeKey(poolMatch.home, poolMatch.away);
  return scoreMap.get(key) || null;
}

function getPrediction(predictions, matchId) {
  if (!predictions) return null;
  return predictions[matchId] ?? predictions[String(matchId)] ?? null;
}

function formatScore(home, away) {
  if (home == null || away == null) return "—";
  return `${home} - ${away}`;
}

function renderPredictionRow(match, prediction, { mode = "pending" } = {}) {
  const result = match.result;
  const exact = mode !== "pending" && isExactPrediction(prediction, result);
  const statusClass =
    mode === "live" ? (exact ? "hit" : "miss") : mode === "finished" ? (exact ? "hit" : "miss") : "pending";
  const badge =
    mode === "live"
      ? exact
        ? `<span class="pred-badge hit">Live exact ✓</span>`
        : `<span class="pred-badge miss">Live · miss</span>`
      : mode === "finished"
        ? exact
          ? `<span class="pred-badge hit">Exact ✓</span>`
          : `<span class="pred-badge miss">Miss</span>`
        : `<span class="pred-badge pending">Pending</span>`;

  const actualBlock =
    mode === "live" || mode === "finished"
      ? `
      <div class="pred-score-box actual">
        <div class="pred-score-label">${mode === "live" ? "Live score" : "Actual"}</div>
        <div class="pred-score-value">${formatScore(result.scoreHome, result.scoreAway)}</div>
      </div>
    `
      : "";

  return `
    <article class="pred-row ${statusClass}${mode === "live" ? " live" : ""}">
      <div class="pred-top">
        <span>${formatMatchWhen(match)}${mode === "live" && result ? ` · ${formatLiveMinute(result)}` : ""}</span>
        ${badge}
      </div>
      <div class="pred-teams">${match.home} vs ${match.away}</div>
      <div class="pred-scores" style="grid-template-columns: ${mode === "pending" ? "1fr" : "1fr 1fr"}">
        <div class="pred-score-box">
          <div class="pred-score-label">Predicted</div>
          <div class="pred-score-value">${formatScore(prediction?.home, prediction?.away)}</div>
        </div>
        ${actualBlock}
      </div>
    </article>
  `;
}

function renderPlayerSheetContent(name) {
  const predictions = poolData.predictions[name] || {};
  const standing = appState.standings.find((entry) => entry.name === name);
  const rank = standing?.rank;
  const matches =
    activePlayerTab === "played"
      ? [...appState.liveMatches, ...appState.finishedMatches]
      : appState.upcomingMatches;

  els.playerSheetTitle.textContent = formatDisplayName(name);
  const evolution = appState.rankEvolution[name];
  let sub = rank ? `#${rank} virtual rank` : "Pool participant";
  if (rank && evolution?.baselineRank != null) {
    sub = `#${rank} now · was #${evolution.baselineRank} before last ${ARROW_MATCH_LOOKBACK} results`;
  }
  els.playerSheetSub.textContent = sub;

  els.playerSheetStats.innerHTML = `
    <div class="player-stat">
      <div class="player-stat-value">${standing?.points ?? 0}</div>
      <div class="player-stat-label">Virtual points</div>
    </div>
    <div class="player-stat">
      <div class="player-stat-value">${standing?.exactHits ?? 0}</div>
      <div class="player-stat-label">Exact hits</div>
    </div>
    <div class="player-stat">
      <div class="player-stat-value">${appState.finishedMatches.length}</div>
      <div class="player-stat-label">Finished</div>
    </div>
  `;

  if (!matches.length) {
    els.playerSheetBody.innerHTML = `<div class="empty-state">No ${activePlayerTab} matches yet.</div>`;
    return;
  }

  els.playerSheetBody.innerHTML = matches
    .map((match) => {
      const mode = match.result?.isLive ? "live" : activePlayerTab === "played" ? "finished" : "pending";
      return renderPredictionRow(match, getPrediction(predictions, match.id), { mode });
    })
    .join("");
}

function renderResultPillRow(match) {
  const result = match.result;
  const score = result ? `${result.scoreHome} - ${result.scoreAway}` : "—";
  return `
    <article class="pill-match-row finished">
      <span class="pill-match-date">${formatMatchWhen(match)}${result?.group ? ` · ${result.group}` : ""}</span>
      <div class="pill-match-line">
        <span class="home">${match.home}</span>
        <span class="pill-score">${score}</span>
        <span class="away">${match.away}</span>
      </div>
    </article>
  `;
}

function openInfoSheet(type) {
  closePlayerSheet();

  const upcoming = appState.upcomingMatches.slice(0, CALENDAR_PILL_COUNT);
  const finished = [...appState.finishedMatches].sort((a, b) => (b.when || 0) - (a.when || 0));

  if (type === "calendar") {
    els.infoSheetTitle.textContent = "Calendar";
    els.infoSheetSub.textContent = `Next ${CALENDAR_PILL_COUNT} upcoming matches · MUT`;
    els.infoSheetBody.innerHTML = upcoming.length
      ? `<div class="calendar-list">${renderCalendarGrouped(upcoming)}</div>`
      : `<div class="empty-state">No upcoming matches in the schedule.</div>`;
  } else {
    els.infoSheetTitle.textContent = "Results";
    els.infoSheetSub.textContent = `${finished.length} finished matches`;
    els.infoSheetBody.innerHTML = finished.length
      ? `<div class="pill-match-list">${finished.map(renderResultPillRow).join("")}</div>`
      : `<div class="empty-state">No results yet.</div>`;
  }

  activeInfoSheet = type;
  els.calendarPill.classList.toggle("active", type === "calendar");
  els.resultsPill.classList.toggle("active", type === "results");
  els.infoSheet.classList.add("open");
  els.infoSheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
}

function closeInfoSheet() {
  activeInfoSheet = null;
  els.calendarPill.classList.remove("active");
  els.resultsPill.classList.remove("active");
  els.infoSheet.classList.remove("open");
  els.infoSheet.setAttribute("aria-hidden", "true");
  if (!activePlayer) document.body.classList.remove("sheet-open");
}

function refreshOpenInfoSheet() {
  if (activeInfoSheet) openInfoSheet(activeInfoSheet);
}

function openPlayerSheet(name) {
  closeInfoSheet();
  activePlayer = name;
  activePlayerTab = "played";
  els.playerTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === "played";
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  renderPlayerSheetContent(name);
  els.playerSheet.classList.add("open");
  els.playerSheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
}

function closePlayerSheet() {
  activePlayer = null;
  els.playerSheet.classList.remove("open");
  els.playerSheet.setAttribute("aria-hidden", "true");
  if (!activeInfoSheet) document.body.classList.remove("sheet-open");
}

function setPlayerTab(tabName) {
  activePlayerTab = tabName;
  els.playerTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  if (activePlayer) renderPlayerSheetContent(activePlayer);
}

function isExactPrediction(prediction, result) {
  return (
    prediction &&
    result &&
    Number(prediction.home) === Number(result.scoreHome) &&
    Number(prediction.away) === Number(result.scoreAway)
  );
}

function categorizeMatches(pool, scoreMap) {
  const scoredMatches = [];
  const finishedMatches = [];
  const liveMatches = [];
  const upcomingMatches = [];

  for (const match of pool.matches) {
    const rawResult = resolveMatchResult(match, scoreMap);
    const result = rawResult ? normalizeLiveResult(rawResult) : null;
    const when = getMatchWhen(match);
    const entry = { ...match, result, when };

    if (result) {
      scoredMatches.push(entry);
      if (result.isLive) liveMatches.push(entry);
      else finishedMatches.push(entry);
    } else {
      upcomingMatches.push(entry);
    }
  }

  scoredMatches.sort((a, b) => (b.when || 0) - (a.when || 0));
  finishedMatches.sort((a, b) => (b.when || 0) - (a.when || 0));
  liveMatches.sort((a, b) => (b.when || 0) - (a.when || 0));
  upcomingMatches.sort((a, b) => (a.when || 0) - (b.when || 0));

  return { scoredMatches, finishedMatches, liveMatches, upcomingMatches };
}

function computeVirtualStandings(pool, finishedMatches) {
  const standings = sortAndRankStandings(buildParticipantStats(pool, finishedMatches));
  const rankEvolution = buildRankEvolution(pool, finishedMatches);
  return { standings, rankEvolution };
}

function computeLiveStandings(pool, finishedMatches, liveMatches, snapshots) {
  const allForPoints = [...finishedMatches, ...liveMatches];
  const standings = sortAndRankStandings(buildParticipantStats(pool, allForPoints));
  const rankEvolution = buildLiveRankEvolution(pool, finishedMatches, liveMatches, snapshots);
  return { standings, rankEvolution };
}

function computeStandings(pool, scoreMap, snapshots) {
  const { scoredMatches, finishedMatches, liveMatches, upcomingMatches } = categorizeMatches(
    pool,
    scoreMap
  );
  const virtual = computeVirtualStandings(pool, finishedMatches);
  const live = computeLiveStandings(pool, finishedMatches, liveMatches, snapshots);

  return {
    standings: virtual.standings,
    rankEvolution: virtual.rankEvolution,
    liveStandings: live.standings,
    liveRankEvolution: live.rankEvolution,
    scoredMatches,
    finishedMatches,
    liveMatches,
    upcomingMatches,
  };
}

function assignRanks(standings) {
  let rank = 1;
  return standings.map((entry, index) => {
    if (index > 0) {
      const prev = standings[index - 1];
      const tied = entry.points === prev.points && entry.exactHits === prev.exactHits;
      if (!tied) rank = index + 1;
    }
    return { ...entry, rank };
  });
}

function winnersForMatch(pool, match) {
  if (!match.result) return [];
  return pool.participants.filter((name) =>
    isExactPrediction(getPrediction(pool.predictions[name], match.id), match.result)
  );
}

function renderRanking(standings, rankEvolution, { mode = "virtual" } = {}) {
  els.rankingList.innerHTML = standings
    .map((entry) => {
      const rank = entry.rank;
      const evolution = rankEvolution[entry.name] || { baselineRank: null, results: [] };
      const topClass = rank <= 3 ? ` top-${rank}` : "";
      const pointsTitle = mode === "live" ? "Provisional points (includes live scores)" : "";
      const pointsClass = `rank-points${mode === "live" ? " live-provisional" : ""}`;

      return `
        <li class="rank-row${topClass}">
          <div class="rank-pos-wrap">
            <span class="rank-pos">${rank}</span>
            ${renderRankBaseline(evolution.baselineRank, { mode })}
          </div>
          ${renderRankResults(evolution.results, { mode })}
          <div class="rank-name-wrap">
            <button type="button" class="rank-name-btn" data-player="${entry.name}">${formatDisplayName(entry.name)}</button>
            ${renderRankMove(rank, evolution.baselineRank)}
          </div>
          <div class="rank-meta">
            <div class="${pointsClass}"${pointsTitle ? ` title="${pointsTitle}"` : ""}>${entry.points}</div>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderMatchSpotlight(liveMatches, upcomingMatches) {
  if (!els.matchSpotlight) return;

  if (liveMatches.length) {
    els.matchSpotlightPanel?.classList.add("is-live");
    els.matchSpotlight.innerHTML = liveMatches
      .map((match) => {
        const result = match.result;
        const key = normalizeKey(match.home, match.away);
        const scoreKey = `${result.scoreHome}-${result.scoreAway}`;
        const prev = prevSpotlightScores.get(key);
        const changed = prev !== undefined && prev !== scoreKey;
        prevSpotlightScores.set(key, scoreKey);

        const minuteLabel = formatLiveMinute(result);
        const meta = [minuteLabel, result.group || match.group].filter(Boolean).join(" · ");

        return `
          <article class="match-spotlight-card live${changed ? " score-changed" : ""}">
            <div class="spotlight-top">
              <span class="spotlight-badge live">
                <span class="live-dot-inline"></span>
                Live
              </span>
              <span class="spotlight-meta">${meta}</span>
            </div>
            <div class="spotlight-teams">
              <span class="spotlight-team home">${match.home}</span>
              <span class="spotlight-score">${result.scoreHome} - ${result.scoreAway}</span>
              <span class="spotlight-team away">${match.away}</span>
            </div>
          </article>
        `;
      })
      .join("");
    return;
  }

  els.matchSpotlightPanel?.classList.remove("is-live");
  const next = upcomingMatches[0];
  if (!next) {
    els.matchSpotlight.innerHTML = `<div class="empty-state">No upcoming matches in the schedule.</div>`;
    return;
  }

  els.matchSpotlight.innerHTML = `
    <article class="match-spotlight-card next">
      <div class="spotlight-top">
        <span class="spotlight-badge next">Up next</span>
        <span class="spotlight-meta">${formatMatchWhen(next)}</span>
      </div>
      <div class="spotlight-teams">
        <span class="spotlight-team home">${next.home}</span>
        <span class="spotlight-kickoff">vs</span>
        <span class="spotlight-team away">${next.away}</span>
      </div>
    </article>
  `;
}

function setRankingTab(tabName) {
  activeRankingTab = tabName;
  localStorage.setItem(RANKING_TAB_KEY, tabName);
  els.virtualTab?.classList.toggle("active", tabName === "virtual");
  els.liveTab?.classList.toggle("active", tabName === "live");
  els.virtualTab?.setAttribute("aria-selected", String(tabName === "virtual"));
  els.liveTab?.setAttribute("aria-selected", String(tabName === "live"));
  renderActiveRanking();
}

function renderActiveRanking() {
  const isLiveTab = activeRankingTab === "live";
  const standings = isLiveTab ? appState.liveStandings : appState.standings;
  const evolution = isLiveTab ? appState.liveRankEvolution : appState.rankEvolution;
  renderRanking(standings, evolution, { mode: isLiveTab ? "live" : "virtual" });
  if (els.rankHint) {
    els.rankHint.textContent = isLiveTab
      ? "Provisional rank · # at kickoff · W/L + ? for live · ▲/▼ vs kickoff"
      : "Rank, previous rank (#), W/L pill, name with ▲/▼/dot, then points";
  }
}

function updateLiveTabVisibility(hasLive) {
  els.liveTab?.classList.toggle("hidden", !hasLive);
  if (!hasLive && activeRankingTab === "live") {
    setRankingTab("virtual");
  }
  if (hasLive && !hadLiveMatches) {
    setRankingTab("live");
    showToast("Match live — live ranking");
  }
  hadLiveMatches = hasLive;
}

function renderMatchCard(match, pool, { variant = "finished" } = {}) {
  const result = match.result;
  const winners =
    variant === "finished" || variant === "live" ? winnersForMatch(pool, match) : [];
  const whenLabel = formatMatchWhen(match);

  const scoreText = result ? `${result.scoreHome} - ${result.scoreAway}` : "vs";
  const cardClass =
    variant === "live" ? "live" : variant === "finished" ? "finished" : "";

  const winnersHtml =
    variant === "live"
      ? winners.length
        ? `<div class="match-winners">${winners.length} exact right now: ${winners.slice(0, 4).map(formatDisplayName).join(", ")}${winners.length > 4 ? ` +${winners.length - 4}` : ""}</div>`
        : `<div class="match-winners none">No one exact at ${scoreText} yet</div>`
      : variant === "finished" && winners.length
        ? `<div class="match-winners">${winners.length} exact: ${winners.slice(0, 4).map(formatDisplayName).join(", ")}${winners.length > 4 ? ` +${winners.length - 4}` : ""}</div>`
        : variant === "finished"
          ? `<div class="match-winners none">No exact scores this match</div>`
          : "";

  return `
    <article class="match-card ${cardClass}">
      <div class="match-meta">
        <span>${whenLabel}${variant === "live" && result ? ` · ${formatLiveMinute(result)}` : ""}</span>
        <span>${variant === "live" ? "Live" : result?.group || "Group stage"}</span>
      </div>
      <div class="match-teams">
        <span class="team home">${match.home}</span>
        <span class="score-box">${scoreText}</span>
        <span class="team away">${match.away}</span>
      </div>
      ${winnersHtml}
    </article>
  `;
}

function renderMatches(liveMatches, finishedMatches, upcomingMatches, pool) {
  const recent = [...liveMatches, ...finishedMatches];

  els.matchFeed.innerHTML = recent.length
    ? recent
        .slice(0, 6)
        .map((match) =>
          renderMatchCard(match, pool, { variant: match.result?.isLive ? "live" : "finished" })
        )
        .join("")
    : `<div class="empty-state">No results yet. Rankings update when openfootball publishes new scores.</div>`;

  els.nextFeed.innerHTML = upcomingMatches.length
    ? upcomingMatches.slice(0, 4).map((match) => renderMatchCard(match, pool)).join("")
    : `<div class="empty-state">Group stage complete.</div>`;
}

function setStatus({ live, text, updatedAt }) {
  els.statusText.textContent = text;
  els.lastUpdate.textContent = updatedAt ? formatTime(updatedAt) : "";
  els.liveDot.classList.toggle("live", Boolean(live));
}

async function fetchJson(url, { timeoutMs = 15000, headers = {} } = {}) {
  const bustUrl = `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(bustUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers,
    });
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchGithubDataFile(path) {
  if (IS_LOCAL) {
    return fetchJson(path.startsWith("data/") ? path : `data/${path}`);
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=main`;
  try {
    return await fetchJson(apiUrl, {
      headers: { Accept: "application/vnd.github.raw+json" },
    });
  } catch (error) {
    console.warn(`GitHub API blocked for ${path}, falling back to raw CDN`, error);
    return fetchJson(`${GITHUB_RAW_BASE}/${path}`);
  }
}

function formatLatestResult(match) {
  if (!match?.result) return "";
  return `${match.home} ${match.result.scoreHome}–${match.result.scoreAway} ${match.away}`;
}

function setPullLoading(loading) {
  if (els.pullResultsBtn) {
    els.pullResultsBtn.classList.toggle("spinning", loading);
    els.pullResultsBtn.disabled = loading;
  }
  if (els.refreshBtn) {
    els.refreshBtn.classList.toggle("spinning", loading);
  }
}

async function refresh({ manual = false } = {}) {
  const prevFinishedCount = appState.finishedMatches?.length ?? 0;
  const prevFinishedKeys = new Set(
    (appState.finishedMatches || []).map((match) => normalizeKey(match.home, match.away))
  );
  setPullLoading(true);

  try {
    if (!poolData) {
      poolData = await fetchJson(POOL_URL);
    }

    let scoreMap = new Map();
    let liveSource = "none";
    let liveFetchFailed = false;
    let storedFetchFailed = false;

    try {
      const liveData = await fetchJson(SCORES_URL);
      const openfootballMap = buildScoreMapFromOpenfootball(liveData.matches || []);
      if (openfootballMap.size) liveSource = "openfootball";
      scoreMap = openfootballMap;
    } catch (error) {
      liveFetchFailed = true;
      console.warn("openfootball scores unavailable.", error);
    }

    try {
      const storedData = await fetchGithubDataFile("data/scores.json");
      storedScoresMeta = storedData;
      scoreMap = mergeScoreMaps(scoreMap, buildScoreMapFromStored(storedData));
      if (scoreMap.size) liveSource = storedData.source ? "stored" : liveSource;
    } catch (error) {
      storedFetchFailed = true;
      console.warn("Stored scores unavailable.", error);
      if (liveSource !== "openfootball") storedScoresMeta = null;
    }

    try {
      const scoresVersion = storedScoresMeta?.updatedAt || null;
      if (!rankSnapshots || scoresVersion !== lastSnapshotsScoresVersion) {
        rankSnapshots = await fetchGithubDataFile("data/rank-snapshots.json");
        lastSnapshotsScoresVersion = scoresVersion;
      }
    } catch (error) {
      console.warn("Rank snapshots unavailable.", error);
      rankSnapshots = rankSnapshots || { snapshots: {} };
    }

    const {
      standings,
      rankEvolution,
      liveStandings,
      liveRankEvolution,
      scoredMatches,
      finishedMatches,
      liveMatches,
      upcomingMatches,
    } = computeStandings(poolData, scoreMap, rankSnapshots);

    const hasLive = liveMatches.length > 0;
    const newResults = finishedMatches.filter(
      (match) => !prevFinishedKeys.has(normalizeKey(match.home, match.away))
    );

    appState = {
      standings,
      liveStandings,
      scoredMatches,
      finishedMatches,
      liveMatches,
      upcomingMatches,
      rankEvolution,
      liveRankEvolution,
    };

    updateLiveTabVisibility(hasLive);
    renderMatchSpotlight(liveMatches, upcomingMatches);
    renderActiveRanking();
    renderMatches(liveMatches, finishedMatches, upcomingMatches, poolData);

    if (activePlayer) renderPlayerSheetContent(activePlayer);
    refreshOpenInfoSheet();

    els.playedChip.textContent = `${finishedMatches.length} finished`;

    const leaders = standings.filter((entry) => entry.rank === 1);
    const leaderLabel =
      leaders.length === 0
        ? "—"
        : leaders.length > 1
          ? `${leaders.length} tied (${leaders[0].points} pts)`
          : `${formatDisplayName(leaders[0].name)} (${leaders[0].points} pts)`;

    const storedLabel = storedScoresMeta?.updatedAt
      ? ` · stored ${formatTime(new Date(storedScoresMeta.updatedAt))}`
      : storedScoresMeta?.matchCount
        ? ` · ${storedScoresMeta.matchCount} stored`
        : "";

    const liveLabel = hasLive ? ` · ${liveMatches.length} live now` : "";

    const sourceHint =
      liveFetchFailed && storedFetchFailed
        ? " · could not reach score sources"
        : liveFetchFailed
          ? " · live API blocked, using stored"
          : "";

    const scoresUpdatedMs = storedScoresMeta?.updatedAt
      ? Date.now() - new Date(storedScoresMeta.updatedAt).getTime()
      : null;
    const scoresStale =
      !IS_LOCAL && scoresUpdatedMs != null && scoresUpdatedMs > 15 * 60 * 1000;
    const staleLabel = scoresStale ? " · scores updating slowly" : "";

    setStatus({
      live: hasLive || liveSource === "openfootball",
      text:
        hasLive
          ? `${finishedMatches.length} FT · ${liveMatches.length} live · Leader: ${leaderLabel}${liveLabel}${staleLabel}`
          : liveSource === "openfootball"
            ? `${finishedMatches.length} results · live · Leader: ${leaderLabel}${storedLabel}${staleLabel}`
            : liveSource === "stored"
              ? `${finishedMatches.length} results · stored memory · Leader: ${leaderLabel}${sourceHint}${staleLabel}`
              : `Waiting for results · Leader: ${leaderLabel}${sourceHint}${staleLabel}`,
      updatedAt: new Date(),
    });

    if (manual) {
      if (newResults.length > 0) {
        const latest = newResults[0];
        showToast(
          `+${newResults.length} new · latest: ${formatLatestResult(latest)}`
        );
      } else if (finishedMatches.length > prevFinishedCount) {
        showToast(`${finishedMatches.length} results · ranking updated`);
      } else if (liveFetchFailed && storedFetchFailed) {
        showToast("Could not pull results — check your connection");
      } else if (hasLive) {
        showToast(`Live · ${liveMatches.length} match(es) in play`);
      } else {
        showToast(`${finishedMatches.length} results · no new scores yet`);
      }
    }

    scheduleRefresh(hasLive);
    scheduleLiveClock(hasLive);
  } catch (error) {
    console.error(error);
    setStatus({ live: false, text: "Could not load pool data", updatedAt: null });
    els.rankingList.innerHTML = `<li class="empty-state">Failed to load data. Run a local server from this folder.</li>`;
    if (manual) showToast("Could not load pool data");
  } finally {
    setPullLoading(false);
  }
}

function scheduleRefresh(hasLive = false) {
  if (refreshTimer) window.clearInterval(refreshTimer);
  const interval = hasLive ? LIVE_REFRESH_MS : REFRESH_MS;
  refreshTimer = window.setInterval(() => refresh(), interval);
}

function scheduleLiveClock(hasLive = false) {
  if (liveClockTimer) window.clearInterval(liveClockTimer);
  if (!hasLive) return;

  liveClockTimer = window.setInterval(() => {
    if (!appState.liveMatches?.length) return;
    renderMatchSpotlight(appState.liveMatches, appState.upcomingMatches);
    if (poolData) {
      renderMatches(
        appState.liveMatches,
        appState.finishedMatches,
        appState.upcomingMatches,
        poolData
      );
    }
  }, 30000);
}

function startAutoRefresh() {
  scheduleRefresh();
}

els.refreshBtn.addEventListener("click", () => refresh({ manual: true }));
els.pullResultsBtn?.addEventListener("click", () => refresh({ manual: true }));

els.virtualTab?.addEventListener("click", () => setRankingTab("virtual"));
els.liveTab?.addEventListener("click", () => setRankingTab("live"));

const savedRankingTab = localStorage.getItem(RANKING_TAB_KEY);
if (savedRankingTab === "live" || savedRankingTab === "virtual") {
  activeRankingTab = savedRankingTab;
}
els.virtualTab?.classList.toggle("active", activeRankingTab === "virtual");
els.liveTab?.classList.toggle("active", activeRankingTab === "live");
els.virtualTab?.setAttribute("aria-selected", String(activeRankingTab === "virtual"));
els.liveTab?.setAttribute("aria-selected", String(activeRankingTab === "live"));

function applyTheme(theme) {
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    metaTheme?.setAttribute("content", "#0f172a");
    els.themeBtn?.setAttribute("aria-label", "Switch to light mode");
  } else {
    document.documentElement.removeAttribute("data-theme");
    metaTheme?.setAttribute("content", "#e2e8f0");
    els.themeBtn?.setAttribute("aria-label", "Switch to dark mode");
  }
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");
}

els.themeBtn?.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  applyTheme(isDark ? "light" : "dark");
});

initTheme();

els.rankingList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-player]");
  if (button) openPlayerSheet(button.dataset.player);
});

els.playerSheetClose.addEventListener("click", closePlayerSheet);
els.playerSheetBackdrop.addEventListener("click", closePlayerSheet);

els.calendarPill.addEventListener("click", () => {
  if (activeInfoSheet === "calendar") closeInfoSheet();
  else openInfoSheet("calendar");
});

els.resultsPill.addEventListener("click", () => {
  if (activeInfoSheet === "results") closeInfoSheet();
  else openInfoSheet("results");
});

els.infoSheetClose.addEventListener("click", closeInfoSheet);
els.infoSheetBackdrop.addEventListener("click", closeInfoSheet);

els.playerTabs.forEach((tab) => {
  tab.addEventListener("click", () => setPlayerTab(tab.dataset.tab));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (activePlayer) closePlayerSheet();
    else if (activeInfoSheet) closeInfoSheet();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

refresh();
startAutoRefresh();
