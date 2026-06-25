// Knockout phase: login, first-time setup, account, recovery, and the
// "My picks" editor with per-match countdowns. Talks to the FastAPI backend
// reverse-proxied at /wc2026/api/ (same origin in production).

const IS_LOCAL_DEV =
  ["localhost", "127.0.0.1"].includes(location.hostname) || location.protocol === "file:";
const API_ROOT = IS_LOCAL_DEV ? "http://127.0.0.1:8001" : "api";
const CUTOFF_FALLBACK_MIN = 60;

const modal = document.getElementById("authModal");
const modalBody = document.getElementById("authModalBody");
const modalTitle = document.getElementById("authModalTitle");
const authBtn = document.getElementById("authBtn");

let me = null;
let meta = { securityQuestions: [], cutoffMinutes: CUTOFF_FALLBACK_MIN };
let countdownTimer = null;

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
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const message = data?.error || data?.detail || `Request failed (${res.status})`;
    const err = new Error(message);
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

function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function setMsg(text, kind = "info") {
  const el = modalBody.querySelector(".auth-msg");
  if (el) {
    el.textContent = text || "";
    el.className = `auth-msg ${kind}`;
  }
}

function questionOptions(selected = "") {
  return meta.securityQuestions
    .map((q) => `<option value="${esc(q)}" ${q === selected ? "selected" : ""}>${esc(q)}</option>`)
    .join("");
}

// --------------------------------------------------------------------------- //
// Views
// --------------------------------------------------------------------------- //
function showLogin() {
  openModal(
    "Log in",
    `
    <form class="auth-form" id="loginForm">
      <label>Name<input name="username" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="auth-submit">Log in</button>
      <p class="auth-msg"></p>
      <button type="button" class="auth-link" id="toRecovery">Forgot password?</button>
    </form>
  `
  );
  modalBody.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      me = await api("/auth/login", {
        method: "POST",
        body: { username: fd.get("username").trim(), password: fd.get("password") },
      });
      afterAuthChange();
      if (me.mustChangePassword) showFirstSetup();
      else if (me.needsRecoverySetup) showFirstSetup();
      else showMyPicks();
    } catch (err) {
      setMsg(err.message, "error");
    }
  });
  modalBody.querySelector("#toRecovery").addEventListener("click", showRecoveryStart);
}

function showFirstSetup() {
  openModal(
    "Set up your account",
    `
    <form class="auth-form" id="setupForm">
      <p class="auth-hint">Choose a new password and recovery details so you can reset it later.</p>
      <label>New password<input name="new_password" type="password" minlength="6" autocomplete="new-password" required></label>
      <label>Date of birth<input name="dob" type="date" required></label>
      <label>Security question<select name="security_question" required>${questionOptions()}</select></label>
      <label>Answer<input name="security_answer" autocomplete="off" required></label>
      <button type="submit" class="auth-submit">Save and continue</button>
      <p class="auth-msg"></p>
    </form>
  `
  );
  modalBody.querySelector("#setupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/auth/first-setup", {
        method: "POST",
        body: {
          new_password: fd.get("new_password"),
          dob: fd.get("dob"),
          security_question: fd.get("security_question"),
          security_answer: fd.get("security_answer"),
        },
      });
      me = await api("/auth/me");
      afterAuthChange();
      showMyPicks();
    } catch (err) {
      setMsg(err.message, "error");
    }
  });
}

function navHtml(active) {
  const tab = (id, label) =>
    `<button type="button" class="auth-nav-tab ${active === id ? "active" : ""}" data-nav="${id}">${label}</button>`;
  const adminTab = me?.role === "admin" ? `<a class="auth-nav-tab" href="admin.html">Admin</a>` : "";
  return `<div class="auth-nav">${tab("picks", "My picks")}${tab("account", "Account")}${adminTab}<button type="button" class="auth-nav-tab logout" data-nav="logout">Log out</button></div>`;
}

function wireNav() {
  modalBody.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nav = btn.dataset.nav;
      if (nav === "picks") showMyPicks();
      else if (nav === "account") showAccount();
      else if (nav === "logout") {
        try {
          await api("/auth/logout", { method: "POST" });
        } catch (_) {}
        me = null;
        afterAuthChange();
        closeModal();
      }
    });
  });
}

function lockInfo(match) {
  const cutoffMin = meta.cutoffMinutes || CUTOFF_FALLBACK_MIN;
  if (!match.kickoffUtc) return { locked: !!match.locked, lockAt: null };
  const lockAt = new Date(match.kickoffUtc).getTime() - cutoffMin * 60 * 1000;
  return { locked: match.locked || Date.now() >= lockAt, lockAt };
}

function fmtCountdown(ms) {
  if (ms <= 0) return "Locked";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `Locks in ${d}d ${h}h`;
  if (h > 0) return `Locks in ${h}h ${m}m`;
  if (m > 0) return `Locks in ${m}m ${sec}s`;
  return `Locks in ${sec}s`;
}

async function showMyPicks() {
  openModal("Knockout picks", `${navHtml("picks")}<div id="picksList"><p class="auth-hint">Loading…</p></div>`);
  wireNav();
  const listEl = modalBody.querySelector("#picksList");
  let matches = [];
  try {
    const data = await api("/ko/matches");
    matches = data.matches || [];
  } catch (err) {
    listEl.innerHTML = `<p class="auth-msg error">${esc(err.message)}</p>`;
    return;
  }
  if (!matches.length) {
    listEl.innerHTML = `<p class="auth-hint">No knockout matches published yet. Check back when the group stage ends.</p>`;
    return;
  }

  listEl.innerHTML = matches
    .map((m) => {
      const { locked } = lockInfo(m);
      const p = m.prediction || {};
      const ph = p.home ?? "";
      const pa = p.away ?? "";
      return `
      <div class="pick-row ${locked ? "locked" : ""}" data-id="${m.id}" data-kickoff="${esc(m.kickoffUtc || "")}">
        <div class="pick-stage">${esc(m.stage)}</div>
        <div class="pick-teams">
          <span class="pick-team">${esc(m.home)}</span>
          <input class="pick-score" data-side="home" type="number" min="0" max="99" value="${ph}" ${locked ? "disabled" : ""}>
          <span class="pick-dash">–</span>
          <input class="pick-score" data-side="away" type="number" min="0" max="99" value="${pa}" ${locked ? "disabled" : ""}>
          <span class="pick-team">${esc(m.away)}</span>
        </div>
        <div class="pick-foot">
          <span class="pick-countdown" data-kickoff="${esc(m.kickoffUtc || "")}"></span>
          ${locked ? "" : `<button type="button" class="pick-save" data-id="${m.id}">Save</button>`}
        </div>
        <p class="auth-msg" data-msg="${m.id}"></p>
      </div>`;
    })
    .join("");

  listEl.querySelectorAll(".pick-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".pick-row");
      const id = Number(btn.dataset.id);
      const home = row.querySelector('input[data-side="home"]').value;
      const away = row.querySelector('input[data-side="away"]').value;
      const msg = row.querySelector("[data-msg]");
      if (home === "" || away === "") {
        msg.textContent = "Enter both scores.";
        msg.className = "auth-msg error";
        return;
      }
      try {
        await api("/ko/predictions", {
          method: "PUT",
          body: { ko_match_id: id, home: Number(home), away: Number(away) },
        });
        msg.textContent = "Saved.";
        msg.className = "auth-msg ok";
        if (typeof window.wcRefresh === "function") window.wcRefresh();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "auth-msg error";
        if (err.status === 403) showMyPicks();
      }
    });
  });

  startCountdowns();
}

function startCountdowns() {
  if (countdownTimer) window.clearInterval(countdownTimer);
  const tick = () => {
    const cutoffMin = meta.cutoffMinutes || CUTOFF_FALLBACK_MIN;
    modalBody.querySelectorAll(".pick-countdown").forEach((el) => {
      const kickoff = el.dataset.kickoff;
      if (!kickoff) {
        el.textContent = "Time TBD";
        return;
      }
      const lockAt = new Date(kickoff).getTime() - cutoffMin * 60 * 1000;
      el.textContent = fmtCountdown(lockAt - Date.now());
    });
  };
  tick();
  countdownTimer = window.setInterval(tick, 1000);
}

function showAccount() {
  openModal(
    "Account",
    `${navHtml("account")}
    <form class="auth-form" id="pwForm">
      <h3 class="auth-subhead">Change password</h3>
      <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
      <label>New password<input name="new_password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button type="submit" class="auth-submit">Update password</button>
      <p class="auth-msg" data-msg="pw"></p>
    </form>
    <form class="auth-form" id="recForm">
      <h3 class="auth-subhead">Recovery details</h3>
      <label>Date of birth<input name="dob" type="date" required></label>
      <label>Security question<select name="security_question" required>${questionOptions()}</select></label>
      <label>Answer<input name="security_answer" autocomplete="off" required></label>
      <button type="submit" class="auth-submit">Update recovery</button>
      <p class="auth-msg" data-msg="rec"></p>
    </form>`
  );
  wireNav();
  modalBody.querySelector("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = modalBody.querySelector('[data-msg="pw"]');
    try {
      await api("/account/password", {
        method: "POST",
        body: { current_password: fd.get("current_password"), new_password: fd.get("new_password") },
      });
      msg.textContent = "Password updated.";
      msg.className = "auth-msg ok";
      e.target.reset();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "auth-msg error";
    }
  });
  modalBody.querySelector("#recForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = modalBody.querySelector('[data-msg="rec"]');
    try {
      await api("/account/recovery", {
        method: "POST",
        body: {
          dob: fd.get("dob"),
          security_question: fd.get("security_question"),
          security_answer: fd.get("security_answer"),
        },
      });
      msg.textContent = "Recovery details updated.";
      msg.className = "auth-msg ok";
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "auth-msg error";
    }
  });
}

function showRecoveryStart() {
  openModal(
    "Reset password",
    `
    <form class="auth-form" id="recStartForm">
      <p class="auth-hint">Enter your name to see your security question.</p>
      <label>Name<input name="username" required></label>
      <button type="submit" class="auth-submit">Continue</button>
      <p class="auth-msg"></p>
      <button type="button" class="auth-link" id="backToLogin">Back to login</button>
    </form>
  `
  );
  modalBody.querySelector("#backToLogin").addEventListener("click", showLogin);
  modalBody.querySelector("#recStartForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = new FormData(e.target).get("username").trim();
    try {
      const data = await api(`/recovery/question?username=${encodeURIComponent(username)}`);
      showRecoveryReset(username, data.securityQuestion);
    } catch (err) {
      setMsg(err.message, "error");
    }
  });
}

function showRecoveryReset(username, question) {
  openModal(
    "Reset password",
    `
    <form class="auth-form" id="recResetForm">
      <p class="auth-hint">Verify your identity to set a new password.</p>
      <p class="auth-question">${esc(question)}</p>
      <label>Answer<input name="security_answer" autocomplete="off" required></label>
      <label>Date of birth<input name="dob" type="date" required></label>
      <label>New password<input name="new_password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button type="submit" class="auth-submit">Reset password</button>
      <p class="auth-msg"></p>
    </form>
  `
  );
  modalBody.querySelector("#recResetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/recovery/reset", {
        method: "POST",
        body: {
          username,
          dob: fd.get("dob"),
          security_answer: fd.get("security_answer"),
          new_password: fd.get("new_password"),
        },
      });
      setMsg("Password reset. You can log in now.", "ok");
      setTimeout(showLogin, 1200);
    } catch (err) {
      setMsg(err.message, "error");
    }
  });
}

// --------------------------------------------------------------------------- //
// State / wiring
// --------------------------------------------------------------------------- //
function afterAuthChange() {
  if (me) {
    authBtn.textContent = me.username;
    authBtn.classList.add("logged-in");
  } else {
    authBtn.textContent = "Log in";
    authBtn.classList.remove("logged-in");
  }
}

authBtn.addEventListener("click", () => {
  if (!me) {
    showLogin();
  } else if (me.mustChangePassword || me.needsRecoverySetup) {
    showFirstSetup();
  } else {
    showMyPicks();
  }
});

document.getElementById("authModalBackdrop").addEventListener("click", closeModal);
document.getElementById("authModalClose").addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});

(async function init() {
  try {
    meta = await api("/meta");
  } catch (_) {
    // backend may be unreachable in pure static dev; keep defaults.
  }
  try {
    me = await api("/auth/me");
  } catch (_) {
    me = null;
  }
  afterAuthChange();
})();
