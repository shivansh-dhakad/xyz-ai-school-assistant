// API_BASE can be defined by a portal-specific config.js (loaded before this
// file) so each of the 4 role portals can point at a xyz-ai backend hosted
// on a different origin. Defaults to same-origin "/api" for the combined
// xyz-ai reference app, where the backend serves this frontend directly.
const API = (typeof API_BASE !== "undefined" ? API_BASE : "/api");

const state = {
  token: localStorage.getItem("xyzai_token") || null,
  user: JSON.parse(localStorage.getItem("xyzai_user") || "null"),
  lang: localStorage.getItem("xyzai_lang") || "en",
  chatSessionId: null, // typed chatbot's own history — never mixes with live conversation
  liveSessionId: null, // live-conversation overlay's own history — separate session, separate thread, never shown/combined in the chat panel
  voiceEnabled: true,
  recognizing: false,
  // true exactly while the live-conversation overlay (the AI face) is open —
  // this is also what gates whether replies get spoken aloud at all, so
  // voice only ever happens together with the face, never in the plain
  // typed chatbot.
  conversationMode: false,
  lastAssistantText: "", // most recent message in the typed chatbot thread
  lastLiveText: "", // most recent message in the live-conversation session, used to re-greet aloud when the overlay reopens
  chatRecognizing: false, // dictate-to-text mic in the plain chat box (separate from the live overlay's mic)
};

let currentTtsAudio = null; // the <audio> element currently playing a synthesized reply, if any

// ---------------- API helper ----------------

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

// ---------------- i18n / language ----------------

const LANG_SELECT_IDS = ["lang-select-login", "lang-select-app", "lang-select-sidebar"];

function populateLangSelects() {
  for (const id of LANG_SELECT_IDS) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.innerHTML = "";
    for (const [code, meta] of Object.entries(LANGUAGES)) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = meta.label;
      if (code === state.lang) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", (e) => setLanguage(e.target.value));
  }
}

function setLanguage(lang) {
  // Bug fix: switching language mid-conversation used to leave the *voice*
  // pipeline on the old language, even though on-screen text and future
  // chat replies switched immediately. Two independent objects were the
  // cause: (1) window.speechSynthesis silently keeps talking in whatever
  // voice it already started with if you don't hard-cancel before the
  // language changes, and (2) the old SpeechRecognition instance kept its
  // .lang from when it was created. Tearing both down here, synchronously,
  // every time the language changes — not just when chat starts — is what
  // actually fixes it; every new speak()/toggleMic() call after this reads
  // state.lang fresh.
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (currentTtsAudio) { currentTtsAudio.pause(); currentTtsAudio = null; }
  speechQueue = [];
  isSpeaking = false;
  if (recognizer) {
    recognizer.onend = null; // don't let the old instance's onend fire and fight the new state
    recognizer.onresult = null;
    try { recognizer.stop(); } catch (e) { /* already stopped */ }
    recognizer = null;
  }
  state.recognizing = false;
  state.conversationMode = false;
  setOrbState("idle");
  closeLiveOverlay();
  setConversationButtonState(false);

  state.lang = lang;
  localStorage.setItem("xyzai_lang", lang);
  for (const id of LANG_SELECT_IDS) {
    const sel = document.getElementById(id);
    if (sel) sel.value = lang;
  }
  document.documentElement.dir = lang === "ur" ? "rtl" : "ltr";
  applyI18n();
  if (state.user) renderHome();
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"), state.lang);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"), state.lang);
  });
  const profileLang = document.getElementById("profile-lang");
  if (profileLang) profileLang.textContent = LANGUAGES[state.lang].label;
}

// ---------------- toast ----------------

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------------- auth ----------------

const DEMO_CREDS = {
  student: "student@example.com",
  parent: "parent@example.com",
  teacher: "teacher@example.com",
  principal: "principal@example.com",
};

function initials(name) {
  return (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

async function doLogin(email, password) {
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  try {
    const data = await api("/auth/login", { method: "POST", body: { email, password } });
    // Portal separation: student-portal/parent-portal/staff-portal/management-portal
    // each set PORTAL_ROLE in their config.js and only ever sign in a user of
    // that role — this is a UX guard (the real authorization boundary is
    // still the JWT role check on every backend endpoint).
    if (typeof PORTAL_ROLE !== "undefined" && data.role !== PORTAL_ROLE) {
      errEl.textContent = t("wrongPortal", state.lang);
      return;
    }
    state.token = data.access_token;
    state.user = { id: data.user_id, role: data.role, full_name: data.full_name };
    localStorage.setItem("xyzai_token", state.token);
    localStorage.setItem("xyzai_user", JSON.stringify(state.user));
    // Always start a brand-new AI session on login. Without this, signing
    // in as a different role in the same tab (e.g. testing student, then
    // teacher, then principal) reused the previous role's chatSessionId/
    // liveSessionId, so startChat()/startLiveConversation() saw a
    // session already set and skipped fetching a fresh greeting entirely -
    // the assistant just stayed silent for whichever role logged in second.
    state.chatSessionId = null;
    state.liveSessionId = null;
    state.lastAssistantText = "";
    state.lastLiveText = "";
    enterApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function logout() {
  if (state.conversationMode) endLiveConversation();
  state.token = null;
  state.user = null;
  state.chatSessionId = null;
  state.liveSessionId = null;
  state.lastAssistantText = "";
  state.lastLiveText = "";
  localStorage.removeItem("xyzai_token");
  localStorage.removeItem("xyzai_user");
  document.getElementById("screen-app").classList.add("hidden");
  document.getElementById("screen-login").classList.remove("hidden");
}

function enterApp() {
  document.getElementById("screen-login").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("hidden");
  document.getElementById("user-name").textContent = state.user.full_name;
  document.getElementById("user-role").textContent = state.user.role;
  document.getElementById("user-initials").textContent = initials(state.user.full_name);
  document.getElementById("user-name-side").textContent = state.user.full_name;
  document.getElementById("user-role-side").textContent = state.user.role;
  document.getElementById("user-initials-side").textContent = initials(state.user.full_name);
  document.getElementById("profile-name").textContent = state.user.full_name;
  document.getElementById("profile-role").textContent = state.user.role;
  document.getElementById("profile-initials").textContent = initials(state.user.full_name);
  setAvatarPersona(state.user.role);
  switchView("home");
  renderHome();
}

// ---------------- navigation ----------------

function switchView(view) {
  if (view !== "chat" && state.conversationMode) endLiveConversation();
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("screen-app").classList.toggle("chat-mode", view === "chat");
  if (view === "chat") showAssistantLanding();
  if (view === "contacts") renderContactsView();
}

function showAssistantLanding() {
  if (state.conversationMode) endLiveConversation();
  const landing = document.getElementById("assistant-landing");
  const workspace = document.getElementById("assistant-workspace");
  if (landing) landing.classList.remove("hidden");
  if (workspace) workspace.classList.add("hidden");
}

async function openAssistantMode(mode) {
  const landing = document.getElementById("assistant-landing");
  const workspace = document.getElementById("assistant-workspace");
  if (landing) landing.classList.add("hidden");
  if (workspace) workspace.classList.remove("hidden");
  if (mode === "live") {
    await startLiveConversation();
    return;
  }
  if (!state.chatSessionId) await startChat();
  document.getElementById("chat-input")?.focus();
}

// ---------------- home rendering ----------------

async function renderHome() {
  const el = document.getElementById("home-content");
  el.innerHTML = `<div class="empty-note">${t("thinking", state.lang)}</div>`;
  try {
    if (state.user.role === "student") await renderStudentHome(el);
    else if (state.user.role === "parent") await renderParentHome(el);
    else if (state.user.role === "teacher") await renderTeacherHome(el);
    else if (state.user.role === "principal") await renderPrincipalHome(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-note">${e.message}</div>`;
  }
}

function ringSvg(pct, size = 96, stroke = 10) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--late)" : "var(--bad)";
  return `<svg width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
  </svg>`;
}

function attendanceCard(summary) {
  return `
  <div class="stat-card">
    <div class="ring-row">
      <div class="ring-wrap">
        ${ringSvg(summary.percentage)}
        <div class="ring-pct">${summary.percentage}%</div>
      </div>
      <div class="attend-breakdown">
        <div class="attend-tag present">${summary.present} ${t("present", state.lang)}</div>
        <div class="attend-tag late">${summary.late} ${t("late", state.lang)}</div>
        <div class="attend-tag absent">${summary.absent} ${t("absent", state.lang)}</div>
      </div>
    </div>
  </div>`;
}

function historyList(records) {
  if (!records.length) return `<div class="empty-note">—</div>`;
  return `<div class="stat-card">${records.slice(0, 10).map(r => `
    <div class="history-row">
      <span>${r.date}</span>
      <span class="status-pill ${r.status}">${t(r.status, state.lang)}</span>
    </div>`).join("")}</div>`;
}

async function renderStudentHome(el) {
  const dashboardSummary = await api(`/student/${await currentStudentId()}/attendance`);
  const dashboardHistory = await api(`/student/${dashboardSummary.student_id}/attendance/history?period=last_30_days`);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  el.innerHTML = `<div class="student-dashboard">
    <section class="student-welcome"><div><h1>${greeting}, ${state.user.full_name.split(" ")[0]}</h1><p>Ready for another great day?</p></div><div class="student-avatar">${initials(state.user.full_name)}</div></section>
    <section class="student-dashboard-card student-overview"><h2>Attendance overview</h2><div class="student-divider"></div><div class="student-ring-wrap">${ringSvg(dashboardSummary.percentage, 230, 20)}<strong>${dashboardSummary.percentage}%</strong><span>Present rate</span></div><div class="student-totals"><div><span>Classes</span><b>${dashboardSummary.total_days}</b></div><div><span>Attended</span><b>${dashboardSummary.present + dashboardSummary.late}</b></div><div class="missed"><span>Missed</span><b>${dashboardSummary.absent}</b></div></div></section>
    <section class="student-dashboard-card student-contact-card"><span>Need help with your attendance or classes?</span><h2>Contact your teacher</h2><p>Send a contact request directly to your assigned teacher.</p><button class="dashboard-primary-btn" onclick="requestContact(${dashboardSummary.student_id}, 'teacher')">Contact teacher</button></section>
    <section class="student-dashboard-card student-recent"><h2>Recent attendance</h2><div class="student-divider"></div>${dashboardHistory.records.slice(0, 5).map((record) => `<div class="student-recent-row"><i class="${record.status}"></i><div><strong>${record.date}</strong><small>${record.status === 'absent' ? 'Attendance not recorded' : 'Attendance recorded'}</small></div><span class="student-status ${record.status}">${t(record.status, state.lang)}</span></div>`).join("")}</section>
  </div>`;
  return;
  const summary = await api(`/student/${await currentStudentId()}/attendance`);
  const history = await api(`/student/${summary.student_id}/attendance/history?period=last_30_days`);
  el.innerHTML = `
    <div class="section-title">${t("myAttendance", state.lang)}</div>
    ${attendanceCard(summary)}
    <div class="section-title">${t("recentDays", state.lang)}</div>
    ${historyList(history.records)}`;
}

let _studentIdCache = null;
let _parentDashboardStudentId = null;
async function currentStudentId() {
  if (_studentIdCache) return _studentIdCache;
  const profile = await api("/student/me/profile");
  _studentIdCache = profile.student_id;
  return _studentIdCache;
}

async function renderParentHome(el) {
  const [dashboardChildren, dashboardRequests] = await Promise.all([api("/parent/children"), api("/contact-requests")]);
  if (!dashboardChildren.children.length) { el.innerHTML = `<div class="dashboard-empty">No linked children yet.</div>`; return; }
  const child = dashboardChildren.children.find((item) => item.student_id === _parentDashboardStudentId) || dashboardChildren.children[0];
  _parentDashboardStudentId = child.student_id;
  const [summary, history] = await Promise.all([api(`/parent/child/${child.student_id}/attendance`), api(`/parent/child/${child.student_id}/attendance/history?period=last_30_days`)]);
  const belowTarget = summary.percentage < 95;
  el.innerHTML = `<div class="dashboard-home parent-dashboard">
    <section class="dashboard-child-switcher"><span>My children</span><div>${dashboardChildren.children.map((item) => `<button class="dashboard-person-pill ${item.student_id === child.student_id ? 'selected' : ''}" onclick="selectParentDashboardStudent(${item.student_id})"><b>${initials(item.name).slice(0, 1)}</b>${escapeHtml(item.name)}</button>`).join("")}</div></section>
    <section class="dashboard-welcome"><h1>${dashboardGreeting(state.user.full_name)}</h1><div class="dashboard-person-pill"><b>${initials(child.name).slice(0, 1)}</b>${escapeHtml(child.name)} <span>⌄</span></div></section>
    <section class="dashboard-card attendance-overview"><div class="dashboard-card-heading"><h2>Attendance overview</h2><span>▣</span></div><div class="attendance-overview-body"><div class="attendance-meter ${belowTarget ? 'attention' : ''}">${ringSvg(summary.percentage, 168, 14)}<strong>${summary.percentage}%</strong></div><div><span class="dashboard-status ${belowTarget ? 'attention' : 'good'}">${belowTarget ? '⚠ Below target' : '✓ On target'}</span><p>${escapeHtml(child.name)} has ${summary.absent} absent day${summary.absent === 1 ? '' : 's'} in the last 30 days. Target attendance is 95%.</p></div></div></section>
    <section class="dashboard-card insight-card"><div class="dashboard-card-heading"><h2><span class="insight-mark">✦</span> AI progress insight</h2></div><p>${escapeHtml(child.name)} is building a steady attendance record at <b>${summary.percentage}%</b>. ${belowTarget ? 'A short follow-up with the teacher may help address recent absences.' : 'Keep up the consistent routine and engagement.'}</p><div class="dashboard-tags"><span>${summary.present} present days</span><span>${summary.absent} absence${summary.absent === 1 ? '' : 's'}</span></div></section>
    <section class="dashboard-card dashboard-requests"><div class="dashboard-card-heading"><h2>Contact requests</h2><button class="dashboard-outline-btn" onclick="switchView('contacts')">View all</button></div>${requestPreview(dashboardRequests.requests)}</section>
    <div class="dashboard-quick-actions"><span>Quick actions</span><button onclick="requestContact(${child.student_id}, 'teacher')">Contact teacher</button><button class="secondary" onclick="requestContact(${child.student_id}, 'management')">Contact principal</button></div>
    <section class="dashboard-card recent-attendance"><div class="dashboard-card-heading"><h2>Recent attendance</h2></div>${history.records.slice(0, 4).map((record) => `<div class="dashboard-history-row"><span>${record.date}</span><b class="status-pill ${record.status}">${t(record.status, state.lang)}</b></div>`).join("")}</section>
  </div>`;
  return;
  const data = await api("/parent/children");
  const requests = await loadContactRequests(false);
  if (!data.children.length) {
    el.innerHTML = `<div class="empty-note">${t("myChildren", state.lang)}: —</div>`;
    return;
  }
  const cards = await Promise.all(data.children.map(async (c) => {
    const summary = await api(`/parent/child/${c.student_id}/attendance`);
    const history = await api(`/parent/child/${c.student_id}/attendance/history?period=last_30_days`);
    const absences = history.records.filter((r) => r.status === "absent");
    const absenceList = absences.length
      ? `<div class="absence-list">${absences.map((r) => `<span class="status-pill absent">${r.date}</span>`).join("")}</div>`
      : `<div class="empty-note-inline">${t("noAbsences", state.lang)}</div>`;
    return `
    <div class="child-card" data-student="${c.student_id}">
      <div class="avatar-chip">${initials(c.name)}</div>
      <div class="info">
        <div class="n">${c.name}</div>
        <div class="s">${c.class_name}</div>
      </div>
      <div class="pct" style="color:${summary.percentage >= 75 ? 'var(--good)' : summary.percentage >= 50 ? 'var(--late)' : 'var(--bad)'}">${summary.percentage}%</div>
    </div>
    <div class="absent-days-block">
      <div class="mini-label">${t("absentDays", state.lang)} (${t("recentDays", state.lang)})</div>
      ${absenceList}
    </div>
    <div class="action-row" style="margin: -4px 0 14px;">
      <button class="chip-btn" onclick="escalate(${c.student_id}, 'teacher')">${t("requestTeacherCall", state.lang)}</button>
    </div>`;
  }));
  // Only one "contact principal" action for the whole account — there is
  // exactly one principal, so this never needs to be repeated per child.
  el.innerHTML = `<div class="section-title">${t("myChildren", state.lang)}</div>` + cards.join("") +
    `<button class="chip-btn contact-principal-btn" onclick="escalate(${data.children[0].student_id}, 'management')">${t("contactPrincipal", state.lang)}</button>` + requests;
}

async function escalate(studentId, target) {
  try {
    await api(`/escalation/${target}`, { method: "POST", body: { student_id: studentId, reason: "Requested via app" } });
    toast(t("requestSent", state.lang));
    if (document.getElementById("view-contacts").classList.contains("active")) await renderContactsView();
    else await renderHome();
  } catch (e) {
    toast(e.message);
  }
}

function contactRequestTarget(target) {
  return ({ parent: "Parent", teacher: "Teacher", management: "Principal" })[target] || "School";
}

function contactRequestDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value == null ? "" : String(value);
  return element.innerHTML;
}

function dashboardGreeting(name, roleLabel = "") {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${greeting}, ${roleLabel || name}`;
}

function requestPreview(requests) {
  const request = requests[0];
  if (!request) return `<div class="dashboard-empty">No contact requests right now.</div>`;
  const contactName = request.can_respond ? request.requester_name : contactRequestTarget(request.target);
  return `<div class="dashboard-request"><div class="dashboard-request-avatar">${initials(contactName)}</div><div class="dashboard-request-copy"><strong>${escapeHtml(contactName)}</strong><span>${escapeHtml(request.reason)}</span><small>${request.status}</small></div>${request.can_respond && request.status === "pending" ? `<button class="dashboard-outline-btn" onclick="respondToContactRequest(${request.request_id}, 'accepted')">Reply</button>` : ""}</div>`;
}

function contactRequestsSection(requests) {
  const cards = requests.length ? requests.map((request) => `
    <div class="contact-request-card">
      <div class="contact-request-head">
        <div>
          <div class="contact-request-name">${escapeHtml(request.can_respond ? request.requester_name : contactRequestTarget(request.target))}</div>
          <div class="contact-request-meta">${request.can_respond ? "From" : "To"}: ${request.can_respond ? escapeHtml(request.requester_name) : contactRequestTarget(request.target)} - ${escapeHtml(request.student_name)} (${escapeHtml(request.class_name)}) - ${contactRequestDate(request.created_at)}</div>
        </div>
        <span class="contact-status ${request.status}">${request.status}</span>
      </div>
      <div class="contact-request-reason">${escapeHtml(request.reason)}</div>
      ${request.can_respond && request.status === "pending" ? `
        <div class="contact-request-actions">
          <button class="contact-decision accept" onclick="respondToContactRequest(${request.request_id}, 'accepted')">Accept</button>
          <button class="contact-decision reject" onclick="respondToContactRequest(${request.request_id}, 'rejected')">Reject</button>
        </div>` : ""}
    </div>`).join("") : `<div class="empty-note">No contact requests yet.</div>`;
  return `<div class="section-title contact-requests-title">Contact requests</div><div class="contact-requests-list">${cards}</div>`;
}

async function loadContactRequests() {
  const data = await api("/contact-requests");
  return contactRequestsSection(data.requests);
}

async function respondToContactRequest(requestId, decision) {
  try {
    await api(`/contact-requests/${requestId}`, { method: "PATCH", body: { decision } });
    toast(`Contact request ${decision}.`);
    if (document.getElementById("view-contacts").classList.contains("active")) await renderContactsView();
    else await renderHome();
  } catch (e) {
    toast(e.message);
  }
}

async function selectParentDashboardStudent(studentId) {
  _parentDashboardStudentId = studentId;
  await renderHome();
}

async function requestContact(studentId, target) {
  try {
    await api("/contact-requests", {
      method: "POST",
      body: { student_id: studentId, target, reason: `Contact requested by ${state.user.role}` },
    });
    toast("Contact request sent.");
    renderHome();
  } catch (e) {
    toast(e.message);
  }
}

async function renderContactsView() {
  const el = document.getElementById("contacts-content");
  el.innerHTML = `<div class="empty-note">${t("thinking", state.lang)}</div>`;
  try {
    const requests = await loadContactRequests();
    let directory = "";
    if (state.user.role === "parent") {
      const data = await api("/parent/children");
      directory = `<div class="section-title">Start a contact request</div>${data.children.map((child) => `
        <div class="contact-directory-card">
          <div><strong>${escapeHtml(child.name)}</strong><div class="contact-request-meta">${escapeHtml(child.class_name)}</div></div>
          <div class="contact-directory-actions">
            <button class="chip-btn" onclick="requestContact(${child.student_id}, 'teacher')">Contact teacher</button>
            <button class="chip-btn" onclick="requestContact(${child.student_id}, 'management')">Contact principal</button>
          </div>
        </div>`).join("")}`;
    } else if (state.user.role === "teacher") {
      const data = await api("/teacher/classes");
      directory = `<div class="section-title">Contact a parent</div><div class="contact-directory-actions">${data.classes.map((schoolClass) =>
        `<button class="chip-btn" onclick="openTeacherContactDirectory(${schoolClass.class_id}, '${schoolClass.class_name}')">${escapeHtml(schoolClass.class_name)}</button>`
      ).join("")}</div><div id="contact-directory-detail"></div>`;
    } else if (state.user.role === "principal") {
      const data = await api("/principal/attendance/analytics");
      directory = `<div class="section-title">Contact a parent or teacher</div><div class="contact-directory-actions">${data.by_class.map((schoolClass) =>
        `<button class="chip-btn" onclick="openPrincipalContactDirectory(${schoolClass.class_id}, '${schoolClass.class_name}')">${escapeHtml(schoolClass.class_name)}</button>`
      ).join("")}</div><div id="contact-directory-detail"></div>`;
    }
    el.innerHTML = directory + requests;
  } catch (error) {
    el.innerHTML = `<div class="empty-note">${escapeHtml(error.message)}</div>`;
  }
}

async function openTeacherContactDirectory(classId, className) {
  const data = await api(`/teacher/class/${classId}/attendance`);
  const el = document.getElementById("contact-directory-detail");
  el.innerHTML = `<div class="section-title">${escapeHtml(className)} parents</div><div class="stat-card">${data.students.map((student) => `
    <div class="student-row"><span class="n">${escapeHtml(student.name)}</span><button class="chip-btn contact-student-btn" onclick="requestContact(${student.student_id}, 'parent')">Contact parent</button></div>`).join("")}</div>`;
}

async function openPrincipalContactDirectory(classId, className) {
  const data = await api(`/principal/class/${classId}/attendance`);
  const el = document.getElementById("contact-directory-detail");
  el.innerHTML = `<div class="section-title">${escapeHtml(className)} contacts</div><div class="stat-card">${data.students.map((student) => `
    <div class="student-row principal-student-row"><span class="n">${escapeHtml(student.name)}</span><div class="contact-student-actions"><button class="chip-btn contact-student-btn" onclick="requestContact(${student.student_id}, 'parent')">Contact parent</button><button class="chip-btn contact-student-btn" onclick="requestContact(${student.student_id}, 'teacher')">Contact teacher</button></div></div>`).join("")}</div>`;
}

async function renderTeacherHome(el) {
  const [dashboardClasses, dashboardRequests] = await Promise.all([api("/teacher/classes"), api("/contact-requests")]);
  if (!dashboardClasses.classes.length) { el.innerHTML = `<div class="dashboard-empty">No assigned classes yet.</div>`; return; }
  const schoolClass = dashboardClasses.classes[0];
  const roster = await api(`/teacher/class/${schoolClass.class_id}/attendance`);
  const students = roster.students.slice(0, 5);
  el.innerHTML = `<div class="dashboard-home teacher-dashboard">
    <section class="dashboard-welcome"><h1>${dashboardGreeting(state.user.full_name)}</h1><p>Here is your academic overview for today.</p></section>
    <h2 class="dashboard-section-title">My classes</h2><section class="teacher-class-feature dashboard-card"><div><span>Class ${escapeHtml(schoolClass.class_name)}</span><strong>${schoolClass.student_count} students</strong><small>Today&apos;s attendance register</small></div><button onclick="openClass(${schoolClass.class_id}, '${schoolClass.class_name}')">→</button></section>
    <h2 class="dashboard-section-title">Student attendance</h2><section class="dashboard-card teacher-roster">${students.map((student) => `<div class="teacher-student"><div class="dashboard-request-avatar">${initials(student.name)}</div><div><strong onclick="viewStudentAttendance(${student.student_id}, '${student.name.replace(/'/g, "\\'")}')">${escapeHtml(student.name)}</strong><small class="${student.status === 'absent' ? 'danger-text' : 'good-text'}">${student.status === 'absent' ? '⚠ Absent today' : student.status === 'unmarked' ? 'Not marked yet' : '✓ ' + student.status}</small></div>${student.status === 'absent' || student.status === 'unmarked' ? `<button class="dashboard-outline-btn" onclick="requestContact(${student.student_id}, 'parent')">Contact parent</button>` : ""}</div>`).join("")}</section>
    <div class="dashboard-quick-actions"><span>Quick actions</span><button onclick="openClass(${schoolClass.class_id}, '${schoolClass.class_name}')">Mark attendance</button><button class="secondary" onclick="switchView('contacts')">Contact a parent</button></div>
    <section class="dashboard-card dashboard-requests"><div class="dashboard-card-heading"><h2>Contact requests</h2><button class="dashboard-outline-btn" onclick="switchView('contacts')">View all</button></div>${requestPreview(dashboardRequests.requests)}</section>
    <div id="class-detail"></div>
  </div>`;
  return;
  const data = await api("/teacher/classes");
  const requests = await loadContactRequests();
  if (!data.classes.length) {
    el.innerHTML = `<div class="empty-note">—</div>`;
    return;
  }
  el.innerHTML = requests + `<div class="section-title">${t("myClasses", state.lang)}</div>` +
    data.classes.map(c => `
    <div class="class-card" onclick="openClass(${c.class_id}, '${c.class_name}')">
      <div class="avatar-chip">${c.class_name.slice(0,2)}</div>
      <div class="info">
        <div class="n">${c.class_name}</div>
        <div class="s">${c.student_count} students</div>
      </div>
    </div>`).join("") +
    `<div id="class-detail"></div>`;
}

async function openClass(classId, className) {
  const data = await api(`/teacher/class/${classId}/attendance`);
  const el = document.getElementById("class-detail");
  if (!el) {
    toast("Open the Home dashboard to mark attendance.");
    return;
  }
  el.innerHTML = `
    <div class="section-title">${className} — ${t("today", state.lang)}</div>
    <div class="stat-card">
      ${data.students.map(s => `
      <div class="student-row">
        <div class="n" onclick="viewStudentAttendance(${s.student_id}, '${s.name.replace(/'/g, "\\'")}')" style="cursor:pointer; text-decoration: underline dotted;">${s.name}</div>
        <div class="mark-btns">
          <button class="mark-btn present ${s.status === 'present' ? 'on' : ''}" onclick="mark(${s.student_id}, 'present', ${classId}, '${className}')">P</button>
          <button class="mark-btn late ${s.status === 'late' ? 'on' : ''}" onclick="mark(${s.student_id}, 'late', ${classId}, '${className}')">L</button>
          <button class="mark-btn absent ${s.status === 'absent' ? 'on' : ''}" onclick="mark(${s.student_id}, 'absent', ${classId}, '${className}')">A</button>
        </div>
        <button class="chip-btn contact-student-btn" onclick="requestContact(${s.student_id}, 'parent')">Contact parent</button>
      </div>`).join("")}
    </div>
    <div id="student-attendance-detail"></div>`;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Shared by teacher (own classes only) and principal (any student, any
// class) — each role hits its own authorization-checked endpoint, per the
// same ownership model as everything else in this app.
async function viewStudentAttendance(studentId, name) {
  const endpoint = state.user.role === "principal"
    ? `/principal/student/${studentId}/attendance/history?period=last_30_days`
    : `/teacher/student/${studentId}/attendance/history?period=last_30_days`;
  const [data, summary] = await Promise.all([
    api(endpoint),
    state.user.role === "teacher" ? api(`/teacher/student/${studentId}/attendance`) : Promise.resolve(null),
  ]);
  const target = document.getElementById("student-attendance-detail") || document.getElementById("class-detail");
  const panel = document.createElement("div");
  panel.className = "card";
  panel.innerHTML = `
    <div class="section-title">${name} — ${t("myAttendance", state.lang)}</div>
    <button class="chip-btn" onclick="this.parentElement.remove()">${t("back", state.lang)}</button>
    ${summary ? attendanceCard(summary) : ""}
    ${historyList(data.records)}`;
  target.innerHTML = "";
  target.appendChild(panel);
}

async function mark(studentId, status, classId, className) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await api("/teacher/attendance", { method: "POST", body: { student_id: studentId, date: today, status } });
    toast(t("markedDone", state.lang));
    openClass(classId, className);
  } catch (e) {
    toast(e.message);
  }
}

async function renderPrincipalHome(el) {
  const [analytics, requestData] = await Promise.all([api("/principal/attendance/analytics"), api("/contact-requests")]);
  const attentionClass = analytics.by_class.slice().sort((a, b) => a.attendance_percentage - b.attendance_percentage)[0];
  el.innerHTML = `<div class="dashboard-home principal-dashboard">
    <section class="dashboard-welcome"><h1>${dashboardGreeting("", "Principal")}</h1><p>Here is your campus overview for today.</p><button class="dashboard-primary-btn" onclick="toast('Daily briefing generated.')">Generate daily briefing</button></section>
    <section class="dashboard-card school-attendance-card"><div><span>School-wide attendance</span><strong>${analytics.overall_percentage}%</strong><small>${analytics.total_students} students across the school</small></div><b class="trend-up">↗ Attendance overview</b></section>
    <section class="dashboard-card principal-insights"><h2><span class="insight-mark">♟</span> AI insights</h2><p><b class="danger-text">Alert:</b> ${attentionClass ? `${escapeHtml(attentionClass.class_name)} has the lowest attendance at ${attentionClass.attendance_percentage}%.` : 'No class alerts today.'}</p><hr><p>Review class-level attendance and contact requests from one dashboard.</p></section>
    <div class="dashboard-card-heading"><h2>Class attendance</h2><span class="dashboard-filter-label">All classes</span></div><section class="dashboard-card class-attendance-table"><div class="class-table-head"><span>Class / Section</span><span>Attendance</span><span>Actions</span></div>${analytics.by_class.map((schoolClass) => `<div class="class-table-row"><b>${escapeHtml(schoolClass.class_name)}</b><strong class="${schoolClass.attendance_percentage < 75 ? 'danger-text' : 'good-text'}">${schoolClass.attendance_percentage}%</strong><span><button onclick="openPrincipalClass(${schoolClass.class_id}, '${schoolClass.class_name}')">View</button><button onclick="openPrincipalContactDirectory(${schoolClass.class_id}, '${schoolClass.class_name}')">Contact</button></span></div>`).join("")}</section>
    <div class="dashboard-quick-actions"><span>Quick actions</span><button onclick="switchView('contacts')">Contact a parent or teacher</button></div>
    <section class="dashboard-card dashboard-requests"><div class="dashboard-card-heading"><h2>Contact requests</h2><button class="dashboard-outline-btn" onclick="switchView('contacts')">View all</button></div>${requestPreview(requestData.requests)}</section><div id="principal-class-detail"></div>
  </div>`;
  return;
  const [data, requests] = await Promise.all([
    api("/principal/attendance/analytics"),
    loadContactRequests(),
  ]);
  el.innerHTML = `
    ${requests}
    <div class="section-title">${t("schoolOverview", state.lang)}</div>
    <div class="stat-grid">
      <div class="mini-stat"><div class="label">${t("overallAttendance", state.lang)}</div><div class="value">${data.overall_percentage}%</div></div>
      <div class="mini-stat"><div class="label">${t("totalStudents", state.lang)}</div><div class="value">${data.total_students}</div></div>
    </div>
    <div class="section-title">${t("byGrade", state.lang)}</div>
    <div class="stat-card">
      ${data.by_grade.map(g => `
      <div class="history-row">
        <span>${g.grade} <span style="color:var(--muted)">(${g.student_count})</span></span>
        <span style="font-weight:700">${g.attendance_percentage}%</span>
      </div>`).join("")}
    </div>
    <div class="section-title">${t("bySection", state.lang)} / ${t("byClass", state.lang)}</div>
    <div class="performance-filters" id="principal-class-filters">
      <button class="chip-btn active" onclick="filterPrincipalClasses('all', this)">All classes</button>
      <button class="chip-btn" onclick="filterPrincipalClasses('bad', this)">Needs attention (&lt;75%)</button>
      <button class="chip-btn" onclick="filterPrincipalClasses('good', this)">Good performance (≥75%)</button>
    </div>
    <div class="stat-card" id="principal-class-list">
      ${data.by_class.map(c => `
      <div class="class-card" data-performance="${c.attendance_percentage >= 75 ? 'good' : 'bad'}" onclick="openPrincipalClass(${c.class_id}, '${c.class_name}')">
        <div class="avatar-chip">${c.class_name.slice(0,2)}</div>
        <div class="info">
          <div class="n">${c.class_name} <span style="color:var(--muted); font-weight:400;">(${t("bySection", state.lang)} ${c.section || "—"})</span></div>
          <div class="s">${c.student_count} students</div>
        </div>
        <div class="pct">${c.attendance_percentage}%</div>
      </div>`).join("")}
    </div>
    <div id="principal-class-detail"></div>`;
}

function filterPrincipalClasses(filter, button) {
  document.querySelectorAll("#principal-class-list .class-card").forEach((card) => {
    card.classList.toggle("hidden-performance", filter !== "all" && card.dataset.performance !== filter);
  });
  document.querySelectorAll("#principal-class-filters .chip-btn").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}

// Student-wise drilldown, opened from a class/section — the principal is
// not restricted to their own classes the way a teacher is.
async function openPrincipalClass(classId, className) {
  const data = await api(`/principal/class/${classId}/attendance`);
  const el = document.getElementById("principal-class-detail");
  const teachers = data.responsible_teachers.length
    ? data.responsible_teachers.map((teacher) => escapeHtml(teacher.name)).join(", ")
    : "No teacher assigned";
  el.innerHTML = `
    <div class="section-title">${className} — ${t("studentWise", state.lang)}</div>
    <div class="responsible-teacher">Responsible teacher: ${teachers}</div>
    <div class="performance-filters" id="principal-student-filters">
      <button class="chip-btn active" onclick="filterPrincipalStudents('all', this)">All students</button>
      <button class="chip-btn" onclick="filterPrincipalStudents('bad', this)">Needs attention (&lt;75%)</button>
      <button class="chip-btn" onclick="filterPrincipalStudents('good', this)">Good performance (≥75%)</button>
    </div>
    <div class="stat-card">
      ${data.students.map(s => `
      <div class="student-row principal-student-row" data-performance="${s.percentage >= 75 ? 'good' : 'bad'}">
        <div class="n" onclick="viewStudentAttendance(${s.student_id}, '${s.name.replace(/'/g, "\\'")}')" style="cursor:pointer; text-decoration: underline dotted;">${s.name}</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="status-pill ${s.today_status}">${t(s.today_status, state.lang)}</span>
          <span style="font-weight:700">${s.percentage}%</span>
        </div>
        <div class="contact-student-actions">
          <button class="chip-btn contact-student-btn" onclick="requestContact(${s.student_id}, 'parent')">Contact parent</button>
          <button class="chip-btn contact-student-btn" onclick="requestContact(${s.student_id}, 'teacher')">Contact teacher</button>
        </div>
      </div>`).join("")}
    </div>
    <div id="student-attendance-detail"></div>`;
}

function filterPrincipalStudents(filter, button) {
  document.querySelectorAll(".principal-student-row").forEach((row) => {
    row.classList.toggle("hidden-performance", filter !== "all" && row.dataset.performance !== filter);
  });
  document.querySelectorAll("#principal-student-filters .chip-btn").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}

// ---------------- chat ----------------

function scrollChatToBottom() {
  const thread = document.getElementById("chat-thread");
  thread.scrollTop = thread.scrollHeight;
}

const ASSISTANT_AVATAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19 9l-5.2 1.9L12 16l-1.8-5.1L5 9l5.2-1.4L12 2z"/></svg>';

function appendMessage(sender, text) {
  const thread = document.getElementById("chat-thread");
  const row = document.createElement("div");
  row.className = "msg-row " + sender;
  if (sender === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.innerHTML = ASSISTANT_AVATAR_SVG;
    row.appendChild(avatar);
  }
  const div = document.createElement("div");
  div.className = "msg " + sender;
  div.textContent = text;
  row.appendChild(div);
  thread.appendChild(row);
  scrollChatToBottom();
  if (sender === "assistant") state.lastAssistantText = text;
}

function showTyping() {
  const thread = document.getElementById("chat-thread");
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  row.id = "typing-indicator";
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.innerHTML = ASSISTANT_AVATAR_SVG;
  row.appendChild(avatar);
  const div = document.createElement("div");
  div.className = "msg assistant typing";
  div.innerHTML = "<span></span><span></span><span></span>";
  row.appendChild(div);
  thread.appendChild(row);
  scrollChatToBottom();
}

function hideTyping() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

function renderChatActions(actions) {
  const el = document.getElementById("chat-actions");
  el.innerHTML = "";
  (actions || []).forEach((a) => {
    const btn = document.createElement("button");
    btn.className = "action-chip";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      el.innerHTML = "";
      sendChat(a.value);
    });
    el.appendChild(btn);
  });
}

async function startChat() {
  document.getElementById("chat-thread").innerHTML = "";
  renderChatActions([]);
  const data = await api("/chat/sessions/start", { method: "POST", body: { language: state.lang } });
  state.chatSessionId = data.session_id;
  appendMessage("assistant", data.greeting);
  setAvatarExpression("neutral");
  // No speak() here: the typed chatbot is text-only. If the person opens
  // live conversation next, this greeting is what gets spoken aloud then
  // (see startLiveConversation), so it isn't lost — just deferred to the
  // moment voice actually applies.
}

async function sendChat(text) {
  if (!text.trim()) return;
  renderChatActions([]);
  appendMessage("user", text);
  document.getElementById("chat-input").value = "";
  setOrbState("thinking");
  showTyping();
  try {
    const data = await api(`/chat/sessions/${state.chatSessionId}/messages`, {
      method: "POST", body: { message: text, language: state.lang },
    });
    hideTyping();
    appendMessage("assistant", data.reply);
    renderChatActions(data.actions);
    setAvatarExpression(data.emotion || "neutral");
    // The typed chatbot is text-only and never speaks - voice only ever
    // happens in the live-conversation overlay's own session, via
    // sendLiveMessage below, so the two histories stay fully separate.
  } catch (e) {
    hideTyping();
    appendMessage("assistant", e.message);
  } finally {
    setOrbState("idle");
  }
}

// ---- live-conversation session: its own ChatSession on the backend, its
// own local history state, never appended to #chat-thread and never shares
// state.chatSessionId with the typed chatbot above - the two are
// intentionally kept from ever mixing, in the transcript or in memory. ----

async function startLiveSession() {
  const data = await api("/chat/sessions/start", { method: "POST", body: { language: state.lang } });
  state.liveSessionId = data.session_id;
  state.lastLiveText = data.greeting;
}

async function sendLiveMessage(text) {
  if (!text.trim() || !state.liveSessionId) { state.liveProcessing = false; return; }
  setOrbState("thinking");
  const hintEl = document.getElementById("voice-hint");
  if (hintEl) hintEl.textContent = t("thinking", state.lang);
  try {
    const data = await api(`/chat/sessions/${state.liveSessionId}/messages`, {
      method: "POST", body: { message: text, language: state.lang },
    });
    setAvatarExpression(data.emotion || "neutral");
    state.lastLiveText = data.reply;
    speak(data.reply);
  } catch (e) {
    state.lastLiveText = e.message;
    speak(e.message);
  } finally {
    // Cleared before setOrbState so a recognizer "onend" that fires around
    // the same time no longer races this and stomps the state back to idle
    // mid-thinking (see recognizer.onend below).
    state.liveProcessing = false;
    setOrbState("idle");
  }
}

// ---- avatar: orb state, head rig, expressions, and mouth/eye animation ----

function setOrbState(mode) {
  const orb = document.getElementById("avatar-orb");
  if (!orb) return;
  orb.classList.remove("listening", "speaking", "thinking");
  if (mode === "listening" || mode === "speaking" || mode === "thinking") orb.classList.add(mode);
}

function setAvatarPersona(role) {
  const orb = document.getElementById("avatar-orb");
  if (!orb) return;
  orb.classList.remove("persona-student", "persona-parent", "persona-teacher", "persona-principal");
  if (role) orb.classList.add("persona-" + role);
}

// Eyebrow and mouth path shapes per expression, in the avatar SVG's 0-100
// viewBox coordinate space. Swapped by setAvatarExpression() (server-driven,
// see the "emotion" field on chat replies) and read by the mouth-animation
// functions below so lip-sync keeps the current mood's mouth shape rather
// than resetting to a generic neutral one mid-conversation.
const BROW_SHAPES = {
  neutral: { l: "M27 44 Q36 39 45 44", r: "M55 44 Q64 39 73 44" },
  happy: { l: "M27 41 Q36 36 45 41", r: "M55 41 Q64 36 73 41" },
  concerned: { l: "M27 46 Q36 42 45 39", r: "M55 39 Q64 42 73 46" },
};
const MOUTH_SHAPES = {
  neutral: { closed: "M34 72 Q50 75 66 72", open: "M34 70 Q50 88 66 70" },
  happy: { closed: "M32 70 Q50 82 68 70", open: "M32 68 Q50 92 68 68" },
  concerned: { closed: "M34 75 Q50 68 66 75", open: "M34 73 Q50 84 66 73" },
};
let currentExpression = "neutral";

function setAvatarExpression(expression) {
  const expr = BROW_SHAPES[expression] ? expression : "neutral";
  currentExpression = expr;
  const orb = document.getElementById("avatar-orb");
  if (orb) {
    orb.classList.remove("expr-neutral", "expr-happy", "expr-concerned");
    orb.classList.add("expr-" + expr);
  }
  const browL = document.getElementById("avatar-brow-l");
  const browR = document.getElementById("avatar-brow-r");
  if (browL) browL.setAttribute("d", BROW_SHAPES[expr].l);
  if (browR) browR.setAttribute("d", BROW_SHAPES[expr].r);
  // Only snap the mouth to the new expression's resting shape if it's not
  // mid lip-sync right now — otherwise this would fight the open/close cycle.
  if (!mouthTimers.length) {
    const mouth = document.getElementById("avatar-mouth");
    if (mouth) mouth.setAttribute("d", MOUTH_SHAPES[expr].closed);
  }
}

let mouthTimers = [];
function clearMouthTimers() {
  mouthTimers.forEach(clearTimeout);
  mouthTimers = [];
  const mouth = document.getElementById("avatar-mouth");
  if (mouth) mouth.setAttribute("d", MOUTH_SHAPES[currentExpression].closed);
}

// Real lip-sync when the TTS provider gives per-word timing, or live
// audio-amplitude analysis of the generated clip otherwise (Indic
// Parler-TTS doesn't return word timing, so this is the normal path); a
// natural talking-mouth flap is the last resort for browser
// speechSynthesis, which exposes no audio stream to analyse at all.
function animateMouthFromWordDurations(wordDurations) {
  clearMouthTimers();
  const mouth = document.getElementById("avatar-mouth");
  if (!mouth) return;
  const shapes = MOUTH_SHAPES[currentExpression];
  wordDurations.forEach((w) => {
    const start = w.startMs ?? w.start_ms ?? 0;
    const end = w.endMs ?? w.end_ms ?? start + 150;
    mouthTimers.push(setTimeout(() => mouth.setAttribute("d", shapes.open), start));
    mouthTimers.push(setTimeout(() => mouth.setAttribute("d", shapes.closed), end));
  });
}

function animateMouthFromAudioElement(audioEl) {
  clearMouthTimers();
  const mouth = document.getElementById("avatar-mouth");
  if (!mouth || !window.AudioContext) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(audioEl);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const openAmount = Math.min(1, avg / 60);
      mouth.setAttribute("d", `M 34 71 Q 50 ${71 + openAmount * 20} 66 71`);
      raf = requestAnimationFrame(tick);
    };
    tick();
    audioEl.addEventListener("ended", () => { cancelAnimationFrame(raf); ctx.close(); clearMouthTimers(); }, { once: true });
  } catch (e) {
    // Some browsers only allow one MediaElementSource per element / require
    // a user gesture to start an AudioContext — fall back to a flap animation.
    animateMouthFlap(audioEl);
  }
}

function animateMouthFlap(untilAudioOrMs) {
  clearMouthTimers();
  const mouth = document.getElementById("avatar-mouth");
  if (!mouth) return;
  const shapes = MOUTH_SHAPES[currentExpression];
  let open = false;
  const interval = setInterval(() => {
    open = !open;
    mouth.setAttribute("d", open ? shapes.open : shapes.closed);
  }, 140);
  mouthTimers.push(interval);
  const stop = () => { clearInterval(interval); mouth.setAttribute("d", shapes.closed); };
  if (untilAudioOrMs instanceof HTMLAudioElement) {
    untilAudioOrMs.addEventListener("ended", stop, { once: true });
  } else if (typeof untilAudioOrMs === "number") {
    setTimeout(stop, untilAudioOrMs);
  }
}

// ---- speech output: local Indic Parler-TTS (natural voice, persona +
// language aware) with automatic fallback to the browser's built-in
// speech synthesis ----
//
// speak() used to kill whatever audio/utterance was already playing the
// instant it was called again (a fast typed follow-up, or the chat mic
// firing while the avatar was still mid-reply) - so a new reply would cut
// the previous one off mid-sentence. Instead, every speak() call now
// enqueues its text and _processSpeechQueue drains it one at a time, only
// starting the next reply once the current one's audio/utterance has
// actually ended - so nothing is ever cut off.
let speechQueue = [];
let isSpeaking = false;

function speak(text) {
  if (!state.voiceEnabled || !text || !text.trim()) return;
  speechQueue.push(text);
  _processSpeechQueue();
}

// Speech bubble above the avatar's head, showing whatever it's currently
// saying out loud - shown/hidden from _speakNow below, exactly in sync
// with actual audio/utterance playback, so it only ever displays while the
// avatar is genuinely speaking. The text is whatever the backend replied
// with for state.lang, so the bubble is always in the same language the
// person is chatting in.
function showAvatarBubble(text, opts = {}) {
  const bubble = document.getElementById("avatar-speech-bubble");
  if (!bubble) return;
  bubble.textContent = text;
  // "user" bubbles (what the mic just heard) get a distinct tint from
  // "assistant" bubbles (what's being spoken back) so it's visually clear
  // whose sentence is currently shown.
  bubble.classList.toggle("user-turn", !!opts.user);
  bubble.classList.add("visible");
}

function hideAvatarBubble() {
  const bubble = document.getElementById("avatar-speech-bubble");
  if (bubble) bubble.classList.remove("visible");
}

// Clears anything queued or currently playing - used when live conversation
// ends, so a stale reply doesn't start speaking after the overlay is closed.
function stopSpeaking() {
  speechQueue = [];
  isSpeaking = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (currentTtsAudio) { currentTtsAudio.pause(); currentTtsAudio = null; }
  clearMouthTimers();
  hideAvatarBubble();
}

function _processSpeechQueue() {
  if (isSpeaking) return; // already playing something - it'll pull the next item itself when it finishes
  const text = speechQueue.shift();
  if (text === undefined) return; // nothing queued
  isSpeaking = true;
  _speakNow(text, () => {
    isSpeaking = false;
    _processSpeechQueue(); // play whatever queued up while this one was speaking
  });
}

async function _speakNow(text, onDone) {
  let tts = null;
  try {
    tts = await api("/tts/speak", { method: "POST", body: { text, language: state.lang } });
  } catch (e) {
    tts = { provider: "browser" };
  }

  if (tts.provider === "indic_parler" && tts.audio_url) {
    const audioEl = new Audio(tts.audio_url);
    currentTtsAudio = audioEl;
    audioEl.onplay = () => {
      setOrbState("speaking");
      const hintEl = document.getElementById("voice-hint");
      if (hintEl) hintEl.textContent = t("speaking", state.lang);
      showAvatarBubble(text);
      if (tts.word_durations && tts.word_durations.length) animateMouthFromWordDurations(tts.word_durations);
      else animateMouthFromAudioElement(audioEl);
    };
    const finish = () => {
      setOrbState("idle");
      const hintEl = document.getElementById("voice-hint");
      if (hintEl) hintEl.textContent = t("tapMicHint", state.lang);
      clearMouthTimers();
      hideAvatarBubble();
      if (audioEl === currentTtsAudio) currentTtsAudio = null;
      maybeContinueConversation();
      onDone();
    };
    audioEl.onended = finish;
    audioEl.onerror = finish;
    audioEl.play().catch(finish);
    return;
  }

  // Fallback: browser Web Speech synthesis. Explicitly resolving a matching
  // voice object (not just setting .lang as a string) is part of the same
  // language-stuck fix as setLanguage() above — some engines otherwise keep
  // reusing whichever voice they last spoke with.
  if (!("speechSynthesis" in window)) { onDone(); return; }
  const localeCode = LANGUAGES[state.lang].voice;
  const applyVoiceAndSpeak = () => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = localeCode;
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang === localeCode) || voices.find((v) => v.lang && v.lang.startsWith(localeCode.split("-")[0]));
    if (match) utter.voice = match;
    utter.rate = 1;
    utter.onstart = () => {
      setOrbState("speaking");
      const hintEl = document.getElementById("voice-hint");
      if (hintEl) hintEl.textContent = t("speaking", state.lang);
      showAvatarBubble(text);
      animateMouthFlap(true);
    };
    utter.onend = () => {
      setOrbState("idle");
      const hintEl = document.getElementById("voice-hint");
      if (hintEl) hintEl.textContent = t("tapMicHint", state.lang);
      clearMouthTimers();
      hideAvatarBubble();
      maybeContinueConversation();
      onDone();
    };
    utter.onerror = () => { setOrbState("idle"); clearMouthTimers(); hideAvatarBubble(); onDone(); };
    window.speechSynthesis.speak(utter);
  };
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = applyVoiceAndSpeak;
  } else {
    applyVoiceAndSpeak();
  }
}

// ---- voice input (Web Speech API) ----
let recognizer = null;
let chatRecognizer = null; // separate recognizer instance for the chat-box mic, so it never fights the live-overlay one
function getRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast(t("micNotSupported", state.lang));
    return;
  }
  const micBtn = document.getElementById("mic-btn");
  if (state.recognizing) {
    state.conversationMode = false;
    setConversationButtonState(false);
    recognizer && recognizer.stop();
    return;
  }
  recognizer = getRecognizer();
  recognizer.lang = LANGUAGES[state.lang].voice; // always read fresh, never cached across a language switch
  recognizer.onstart = () => {
    state.recognizing = true;
    micBtn.classList.add("active");
    setOrbState("listening");
    document.getElementById("voice-hint").textContent = t("listening", state.lang);
  };
  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    // Show what was actually heard in the speech bubble right away, and
    // keep it up until the assistant's reply bubble replaces it (see
    // showAvatarBubble in _speakNow) - previously the user's own words were
    // never shown anywhere in the live overlay at all.
    state.liveProcessing = true;
    showAvatarBubble(transcript, { user: true });
    sendLiveMessage(transcript);
  };
  recognizer.onerror = () => {
    state.liveProcessing = false;
    toast(t("micNotSupported", state.lang));
  };
  recognizer.onend = () => {
    state.recognizing = false;
    micBtn.classList.remove("active");
    // Recognition ending fires right as we start thinking about the reply
    // (sendLiveMessage above) - resetting to idle/tapMicHint here used to
    // immediately overwrite the "thinking" state before anyone could ever
    // see it. Only reset when we're not mid-reply.
    if (!state.liveProcessing) {
      setOrbState("idle");
      document.getElementById("voice-hint").textContent = t("tapMicHint", state.lang);
    }
  };
  recognizer.start();
}

// ---- dictate-to-text mic, embedded directly in the plain chat box.
// Independent of the live-conversation overlay: it only transcribes speech
// into the chat input and sends it — no avatar, no spoken reply. That stays
// exclusive to the live-conversation overlay (see startLiveConversation).
function toggleChatMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast(t("micNotSupported", state.lang));
    return;
  }
  const chatMicBtn = document.getElementById("chat-mic-btn");
  if (state.chatRecognizing) {
    chatRecognizer && chatRecognizer.stop();
    return;
  }
  chatRecognizer = getRecognizer();
  chatRecognizer.lang = LANGUAGES[state.lang].voice; // always read fresh, never cached across a language switch
  chatRecognizer.onstart = () => {
    state.chatRecognizing = true;
    chatMicBtn.classList.add("active");
  };
  chatRecognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById("chat-input").value = transcript;
    sendChat(transcript);
  };
  chatRecognizer.onerror = () => {
    toast(t("micNotSupported", state.lang));
  };
  chatRecognizer.onend = () => {
    state.chatRecognizing = false;
    chatMicBtn.classList.remove("active");
  };
  chatRecognizer.start();
}

// ---- real-time voice conversation: listen -> reply -> speak -> listen again ----

function setConversationButtonState(on) {
  const btn = document.getElementById("conversation-btn");
  if (!btn) return;
  btn.classList.toggle("active", on);
  const label = btn.querySelector("span");
  const text = on ? t("liveConversationOn", state.lang) : t("liveConversation", state.lang);
  if (label) label.textContent = text; else btn.textContent = text;
}

// ---- live-conversation overlay: this is the only place the AI face and
// voice (mic in / TTS out) ever appear, and it covers the full screen
// while it's open. ----

function openLiveOverlay() {
  const overlay = document.getElementById("live-overlay");
  if (overlay) overlay.classList.remove("hidden");
}

function closeLiveOverlay() {
  const overlay = document.getElementById("live-overlay");
  if (overlay) overlay.classList.add("hidden");
}

async function startLiveConversation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast(t("micNotSupported", state.lang));
    return;
  }
  state.conversationMode = true;
  setConversationButtonState(true);
  openLiveOverlay();
  if (!state.liveSessionId) {
    try {
      await startLiveSession();
    } catch (e) {
      toast(e.message);
    }
  }
  // Greet aloud from the live conversation's own session/history - entirely
  // separate from the typed chatbot thread (see sendLiveMessage above) -
  // so opening the face isn't silent; speak()'s onended handler starts
  // listening automatically afterwards.
  if (state.lastLiveText) speak(state.lastLiveText);
  else if (!state.recognizing) toggleMic();
}

function endLiveConversation() {
  state.conversationMode = false;
  setConversationButtonState(false);
  stopSpeaking();
  if (state.recognizing) recognizer && recognizer.stop();
  closeLiveOverlay();
}

function toggleConversationMode() {
  if (state.conversationMode) endLiveConversation();
  else startLiveConversation();
}

function maybeContinueConversation() {
  if (state.conversationMode && !state.recognizing) {
    setTimeout(() => { if (state.conversationMode) toggleMic(); }, 300);
  }
}

// ---------------- wire up ----------------

document.addEventListener("DOMContentLoaded", () => {
  populateLangSelects();
  setLanguage(state.lang);

  document.getElementById("login-btn").addEventListener("click", () => {
    doLogin(document.getElementById("login-email").value.trim(), document.getElementById("login-password").value);
  });
  document.getElementById("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("login-btn").click();
  });
  document.querySelectorAll(".demo-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("login-email").value = DEMO_CREDS[chip.dataset.role];
      document.getElementById("login-password").value = "Password123!";
      doLogin(DEMO_CREDS[chip.dataset.role], "Password123!");
    });
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("logout-btn-side").addEventListener("click", logout);

  document.getElementById("send-btn").addEventListener("click", () => sendChat(document.getElementById("chat-input").value));
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat(e.target.value);
  });
  const micBtn = document.getElementById("mic-btn");
  if (micBtn) micBtn.addEventListener("click", toggleMic);
  const chatMicBtn = document.getElementById("chat-mic-btn");
  if (chatMicBtn) chatMicBtn.addEventListener("click", toggleChatMic);
  const conversationBtn = document.getElementById("conversation-btn");
  if (conversationBtn) conversationBtn.addEventListener("click", toggleConversationMode);
  const liveCloseBtn = document.getElementById("live-overlay-close");
  if (liveCloseBtn) liveCloseBtn.addEventListener("click", endLiveConversation);
  document.getElementById("voice-toggle").addEventListener("change", (e) => {
    state.voiceEnabled = e.target.checked;
  });

  if (state.token && state.user) {
    if (typeof PORTAL_ROLE !== "undefined" && state.user.role !== PORTAL_ROLE) {
      logout();
    } else {
      enterApp();
    }
  }
});