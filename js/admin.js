// Admin panel: user password resets, knockout fixture publishing, audit log.

const IS_LOCAL_DEV =
  ["localhost", "127.0.0.1"].includes(location.hostname) || location.protocol === "file:";
const API_ROOT = IS_LOCAL_DEV ? "http://127.0.0.1:8001" : "api";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const err = new Error(data?.error || data?.detail || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// --------------------------------------------------------------------------- //
// Tabs
// --------------------------------------------------------------------------- //
function showTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["users", "fixtures", "audit"].forEach((t) => {
    document.getElementById(`tab-${t}`).hidden = t !== tab;
  });
  if (tab === "users") loadUsers();
  if (tab === "fixtures") loadFixtures();
  if (tab === "audit") loadAudit();
}

// --------------------------------------------------------------------------- //
// Users
// --------------------------------------------------------------------------- //
async function loadUsers() {
  const el = document.getElementById("usersList");
  try {
    const { users } = await api("/admin/users");
    el.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Name</th><th>Role</th><th>Setup</th><th>Recovery</th><th>Last login</th><th></th></tr></thead>
        <tbody>
        ${users
          .map(
            (u) => `
          <tr>
            <td>${esc(u.username)}</td>
            <td>${esc(u.role)}</td>
            <td>${u.mustChangePassword ? "<span class='pill-warn'>pending</span>" : "done"}</td>
            <td>${u.recoveryReady ? "yes" : "no"}</td>
            <td>${fmtDate(u.lastLogin)}</td>
            <td><button class="pick-save" data-reset="${esc(u.username)}">Reset</button></td>
          </tr>`
          )
          .join("")}
        </tbody>
      </table>`;
    el.querySelectorAll("[data-reset]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Reset password for ${btn.dataset.reset} to fifa2026?`)) return;
        try {
          await api("/admin/reset-password", { method: "POST", body: { username: btn.dataset.reset } });
          toast(`${btn.dataset.reset} reset to fifa2026`);
          loadUsers();
        } catch (err) {
          toast(err.message);
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="auth-msg error">${esc(err.message)}</p>`;
  }
}

// --------------------------------------------------------------------------- //
// Fixtures
// --------------------------------------------------------------------------- //
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function fromLocalInput(value) {
  // Treat the entered datetime-local as UTC wall-clock.
  if (!value) return null;
  return `${value}:00+00:00`;
}

async function loadFixtures() {
  const el = document.getElementById("fixturesList");
  try {
    const { matches } = await api("/admin/ko/matches");
    if (!matches.length) {
      el.innerHTML = `<p class="auth-hint">No fixtures yet. Add one above.</p>`;
      return;
    }
    el.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Stage</th><th>Match</th><th>Kickoff (UTC)</th><th>Score</th><th>Pub</th><th></th></tr></thead>
        <tbody>
        ${matches
          .map(
            (m) => `
          <tr>
            <td>${esc(m.stage)}</td>
            <td>${esc(m.home)} v ${esc(m.away)}</td>
            <td>${esc(m.kickoff_utc || "—")}</td>
            <td>${m.score_home == null ? "—" : `${m.score_home}-${m.score_away}`}</td>
            <td>${m.published ? "✓" : ""}</td>
            <td><button class="pick-save" data-edit='${esc(JSON.stringify(m))}'>Edit</button></td>
          </tr>`
          )
          .join("")}
        </tbody>
      </table>`;
    el.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = JSON.parse(btn.dataset.edit);
        const f = document.getElementById("fixtureForm");
        f.id.value = m.id;
        f.stage.value = m.stage;
        f.home.value = m.home;
        f.away.value = m.away;
        f.kickoff_utc.value = toLocalInput(m.kickoff_utc);
        f.published.checked = !!m.published;
        f.scrollIntoView({ behavior: "smooth" });
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="auth-msg error">${esc(err.message)}</p>`;
  }
}

function wireFixtureForm() {
  document.getElementById("importFromApi").addEventListener("click", async () => {
    const msg = document.querySelector('[data-msg="import"]');
    const stage = document.getElementById("importStage").value || null;
    const upcoming_only = document.getElementById("importUpcoming").checked;
    msg.textContent = "Fetching from API-Football…";
    msg.className = "auth-msg";
    try {
      const result = await api("/admin/ko/import-api", {
        method: "POST",
        body: { stage, upcoming_only },
      });
      const sample = (result.samples || []).slice(0, 3).join(" · ");
      msg.textContent = `Imported ${result.total} fixtures (${result.created} new, ${result.updated} updated).${sample ? ` ${sample}` : ""}`;
      msg.className = "auth-msg ok";
      toast(`API import: ${result.created} new, ${result.updated} updated`);
      loadFixtures();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "auth-msg error";
    }
  });

  document.getElementById("fixtureForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const msg = f.querySelector('[data-msg="fixture"]');
    const payload = {
      id: f.id.value ? Number(f.id.value) : null,
      stage: f.stage.value,
      home: f.home.value.trim(),
      away: f.away.value.trim(),
      kickoff_utc: fromLocalInput(f.kickoff_utc.value),
      published: f.published.checked,
    };
    try {
      await api("/admin/ko/match", { method: "POST", body: payload });
      msg.textContent = "Saved.";
      msg.className = "auth-msg ok";
      f.reset();
      f.id.value = "";
      loadFixtures();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "auth-msg error";
    }
  });

  document.querySelectorAll("[data-publish]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stage = btn.dataset.publish;
      if (!confirm(`Publish all ${stage} fixtures?`)) return;
      try {
        await api("/admin/ko/publish", { method: "POST", body: { stage, published: true } });
        toast(`${stage} published`);
        loadFixtures();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

// --------------------------------------------------------------------------- //
// Audit
// --------------------------------------------------------------------------- //
async function loadAudit() {
  const el = document.getElementById("auditList");
  try {
    const { audit } = await api("/admin/audit");
    el.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
        ${audit
          .map(
            (a) => `<tr><td>${fmtDate(a.ts)}</td><td>${esc(a.actor || "")}</td><td>${esc(a.action)}</td><td>${esc(a.detail || "")}</td></tr>`
          )
          .join("")}
        </tbody>
      </table>`;
  } catch (err) {
    el.innerHTML = `<p class="auth-msg error">${esc(err.message)}</p>`;
  }
}

// --------------------------------------------------------------------------- //
// Init
// --------------------------------------------------------------------------- //
(async function init() {
  const who = document.getElementById("adminWho");
  let me = null;
  try {
    me = await api("/auth/me");
  } catch (_) {}
  if (!me || me.role !== "admin") {
    who.textContent = "Access denied.";
    document.getElementById("adminDenied").hidden = false;
    return;
  }
  who.textContent = `Signed in as ${me.username}`;
  document.getElementById("adminMain").hidden = false;

  document.querySelectorAll("[data-tab]").forEach((btn) =>
    btn.addEventListener("click", () => showTab(btn.dataset.tab))
  );
  document.getElementById("adminLogout").addEventListener("click", async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (_) {}
    location.href = "index.html";
  });
  wireFixtureForm();
  loadUsers();
})();
