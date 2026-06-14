const POOL_URL = "data/pool.json";
const STORED_SCORES_URL = "data/scores.json";
const SCORES_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const REFRESH_MS = 2 * 60 * 1000;
const ARROW_MATCH_LOOKBACK = 5;
const CALENDAR_PILL_COUNT = 10;
const THEME_KEY = "wc-pool-theme";

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
};

let poolData = null;
let storedScoresMeta = null;
let refreshTimer = null;
let appState = {
  standings: [],
  scoredMatches: [],
  finishedMatches: [],
  liveMatches: [],
  upcomingMatches: [],
  rankEvolution: {},
};
let activePlayer = null;
let activePlayerTab = "played";
let activeInfoSheet = null;

function normalizeTeam(name) {
  return TEAM_ALIASES[name] || name;
}

function normalizeKey(home, away) {
  const teams = [normalizeTeam(home), normalizeTeam(away)].sort();
  return `${teams[0]}|${teams[1]}`;
}

function parsePoolDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = String(dateStr).replace(",", "");
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(isoDate) {
  if (!isoDate) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(isoDate);
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

  const steps = [beforeWindow];
  for (let i = 0; i < windowMatches.length; i += 1) {
    steps.push([...beforeWindow, ...windowMatches.slice(0, i + 1)]);
  }

  const ranksAtStep = steps.map((matches) => {
    const standings = sortAndRankStandings(buildParticipantStats(pool, matches));
    return Object.fromEntries(standings.map((entry) => [entry.name, entry.rank]));
  });

  const evolution = {};
  for (const name of pool.participants) {
    const baselineRank = ranksAtStep[0]?.[name] ?? null;
    const arrows = [];

    for (let i = 0; i < ARROW_MATCH_LOOKBACK; i += 1) {
      if (i >= windowMatches.length) {
        arrows.push({ type: "pending", match: null });
        continue;
      }

      const previous = ranksAtStep[i]?.[name];
      const next = ranksAtStep[i + 1]?.[name];
      const match = windowMatches[i];
      const label = match ? `${match.home} ${match.result.scoreHome}-${match.result.scoreAway} ${match.away}` : "";

      if (previous == null || next == null) {
        arrows.push({ type: "pending", match, label });
      } else if (next < previous) {
        arrows.push({ type: "up", match, label, from: previous, to: next });
      } else if (next > previous) {
        arrows.push({ type: "down", match, label, from: previous, to: next });
      } else {
        arrows.push({ type: "same", match, label, from: previous, to: next });
      }
    }

    evolution[name] = { baselineRank, arrows };
  }

  return evolution;
}

function renderRankEvolution({ baselineRank, arrows }) {
  const baselineHtml =
    baselineRank != null
      ? `<span class="rank-baseline" title="Rank before last ${ARROW_MATCH_LOOKBACK} results">#${baselineRank}</span>`
      : `<span class="rank-baseline muted">—</span>`;

  const arrowsHtml = arrows
    .map((step, index) => {
      if (step.type === "pending") {
        return `<span class="evo-arrow pending" title="Match ${index + 1} not played yet"></span>`;
      }

      const title = step.label
        ? `Result ${index + 1}: ${step.label} (#${step.from} → #${step.to})`
        : `Result ${index + 1}`;

      if (step.type === "up") {
        return `<span class="evo-arrow up" title="${title}">▲</span>`;
      }
      if (step.type === "down") {
        return `<span class="evo-arrow down" title="${title}">▼</span>`;
      }
      return `<span class="evo-arrow same" title="${title}"></span>`;
    })
    .join("");

  return `
    <div class="rank-evolution">
      ${baselineHtml}
      <div class="rank-arrows" aria-label="Last ${ARROW_MATCH_LOOKBACK} match movements">${arrowsHtml}</div>
    </div>
  `;
}

function buildScoreMapFromStored(storedData) {
  const map = new Map();
  for (const match of storedData?.matches || []) {
    if (match.scoreHome == null || match.scoreAway == null) continue;
    const key = match.key || normalizeKey(match.home, match.away);
    map.set(key, {
      home: match.home,
      away: match.away,
      scoreHome: match.scoreHome,
      scoreAway: match.scoreAway,
      status: match.status || "finished",
      isLive: false,
      date: match.date,
      round: match.round,
      group: match.group,
      source: "stored",
    });
  }
  return map;
}

function mergeScoreMaps(baseMap, overlayMap) {
  const merged = new Map(baseMap);
  for (const [key, value] of overlayMap) merged.set(key, value);
  return merged;
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

function formatMatchDate(match) {
  if (match.when) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(match.when);
  }
  return match.date || "";
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
        <span>${formatMatchDate(match)}${match.time ? ` · ${match.time}` : ""}${mode === "live" && result.statusText ? ` · ${result.statusText}` : ""}</span>
        ${badge}
      </div>
      <div class="pred-teams">${match.home} vs ${match.away}</div>
      <div class="pred-scores" style="grid-template-columns: ${mode === "pending" ? "1fr" : "1fr 1fr"}">
        <div class="pred-score-box">
          <div class="pred-score-label">Prediction</div>
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

  els.playerSheetTitle.textContent = name;
  const evolution = appState.rankEvolution[name];
  let sub = rank ? `#${rank} virtual rank` : "Pool participant";
  if (rank && evolution?.baselineRank != null) {
    sub = `#${rank} now · was #${evolution.baselineRank} before last ${ARROW_MATCH_LOOKBACK} results`;
  }
  els.playerSheetSub.textContent = sub;

  els.playerSheetStats.innerHTML = `
    <div class="player-stat">
      <div class="player-stat-value">${standing?.points ?? 0}</div>
      <div class="player-stat-label">Virtual pts</div>
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

function formatMatchWhen(match) {
  const when = match.when
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(match.when)
    : match.date || "";
  return `${when}${match.time ? ` · ${match.time}` : ""}`;
}

function renderUpcomingPillRow(match) {
  return `
    <article class="pill-match-row">
      <span class="pill-match-date">${formatMatchWhen(match)}</span>
      <div class="pill-match-teams">${match.home} vs ${match.away}</div>
    </article>
  `;
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
    els.infoSheetSub.textContent = `Next ${CALENDAR_PILL_COUNT} upcoming matches`;
    els.infoSheetBody.innerHTML = upcoming.length
      ? `<div class="pill-match-list">${upcoming.map(renderUpcomingPillRow).join("")}</div>`
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

function computeStandings(pool, scoreMap) {
  const scoredMatches = [];
  const finishedMatches = [];
  const liveMatches = [];
  const upcomingMatches = [];

  for (const match of pool.matches) {
    const result = resolveMatchResult(match, scoreMap);
    const when = parsePoolDate(match.date);
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

  const standings = sortAndRankStandings(buildParticipantStats(pool, scoredMatches));
  const rankEvolution = buildRankEvolution(pool, finishedMatches);

  return {
    standings,
    rankEvolution,
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

function renderRanking(standings, rankEvolution) {
  els.rankingList.innerHTML = standings
    .map((entry) => {
      const rank = entry.rank;
      const evolution = rankEvolution[entry.name] || { baselineRank: null, arrows: [] };
      const topClass = rank <= 3 ? ` top-${rank}` : "";

      return `
        <li class="rank-row${topClass}">
          <span class="rank-pos">${rank}</span>
          ${renderRankEvolution(evolution)}
          <button type="button" class="rank-name-btn" data-player="${entry.name}">${entry.name}</button>
          <div class="rank-meta">
            <div class="rank-points">${entry.points}</div>
            <div class="rank-hits">${entry.exactHits} exact</div>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderMatchCard(match, pool, { variant = "finished" } = {}) {
  const result = match.result;
  const winners =
    variant === "finished" || variant === "live" ? winnersForMatch(pool, match) : [];
  const when = match.when
    ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(match.when)
    : match.date;

  const scoreText = result ? `${result.scoreHome} - ${result.scoreAway}` : "vs";
  const cardClass =
    variant === "live" ? "live" : variant === "finished" ? "finished" : "";

  const winnersHtml =
    variant === "live"
      ? winners.length
        ? `<div class="match-winners">${winners.length} exact right now: ${winners.slice(0, 4).join(", ")}${winners.length > 4 ? ` +${winners.length - 4}` : ""}</div>`
        : `<div class="match-winners none">No one exact at ${scoreText} yet</div>`
      : variant === "finished" && winners.length
        ? `<div class="match-winners">${winners.length} exact: ${winners.slice(0, 4).join(", ")}${winners.length > 4 ? ` +${winners.length - 4}` : ""}</div>`
        : variant === "finished"
          ? `<div class="match-winners none">No exact scores this match</div>`
          : "";

  return `
    <article class="match-card ${cardClass}">
      <div class="match-meta">
        <span>${when}${match.time ? ` · ${match.time}` : ""}${variant === "live" && result.statusText ? ` · ${result.statusText}` : ""}</span>
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

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json();
}

async function refresh({ manual = false } = {}) {
  els.refreshBtn.classList.add("spinning");

  try {
    poolData = await fetchJson(POOL_URL);

    let scoreMap = new Map();
    let liveSource = "none";

    try {
      const storedData = await fetchJson(STORED_SCORES_URL);
      storedScoresMeta = storedData;
      scoreMap = buildScoreMapFromStored(storedData);
      if (scoreMap.size) liveSource = "stored";
    } catch (error) {
      console.warn("Stored scores unavailable.", error);
      storedScoresMeta = null;
    }

    try {
      const liveData = await fetchJson(SCORES_URL);
      scoreMap = mergeScoreMaps(scoreMap, buildScoreMapFromOpenfootball(liveData.matches || []));
      liveSource = "openfootball";
    } catch (error) {
      console.warn("openfootball scores unavailable.", error);
    }

    const { standings, rankEvolution, scoredMatches, finishedMatches, liveMatches, upcomingMatches } =
      computeStandings(poolData, scoreMap);

    appState = {
      standings,
      scoredMatches,
      finishedMatches,
      liveMatches,
      upcomingMatches,
      rankEvolution,
    };
    renderRanking(standings, rankEvolution);
    renderMatches(liveMatches, finishedMatches, upcomingMatches, poolData);

    if (activePlayer) renderPlayerSheetContent(activePlayer);
    refreshOpenInfoSheet();

    els.playedChip.textContent = `${finishedMatches.length} finished`;

    const leaders = standings.filter((entry) => entry.rank === 1);
    const leaderLabel =
      leaders.length > 1
        ? `${leaders.length} tied (${leaders[0].points} pts)`
        : `${leaders[0].name} (${leaders[0].points} pts)`;

    const storedLabel = storedScoresMeta?.updatedAt
      ? ` · stored ${formatTime(new Date(storedScoresMeta.updatedAt))}`
      : storedScoresMeta?.matchCount
        ? ` · ${storedScoresMeta.matchCount} stored`
        : "";

    setStatus({
      live: liveSource === "openfootball",
      text:
        liveSource === "openfootball"
          ? `${finishedMatches.length} results · live · Leader: ${leaderLabel}${storedLabel}`
          : liveSource === "stored"
            ? `${finishedMatches.length} results · stored memory · Leader: ${leaderLabel}`
            : `Waiting for results · Leader: ${leaderLabel}`,
      updatedAt: new Date(),
    });

    if (manual) {
      showToast("Ranking updated");
    }

    scheduleRefresh();
  } catch (error) {
    console.error(error);
    setStatus({ live: false, text: "Could not load pool data", updatedAt: null });
    els.rankingList.innerHTML = `<li class="empty-state">Failed to load data. Run a local server from this folder.</li>`;
  } finally {
    els.refreshBtn.classList.remove("spinning");
  }
}

function scheduleRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => refresh(), REFRESH_MS);
}

function startAutoRefresh() {
  scheduleRefresh();
}

els.refreshBtn.addEventListener("click", () => refresh({ manual: true }));

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
