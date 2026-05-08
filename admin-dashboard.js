(function () {
  const QR_CACHE_KEY = "aura_generated_qr_cache_v1";

  let user = null;
  let events = [];
  let users = [];
  let activeView = "overview";
  let activeQrPublicId = null;
  let qrCache = loadQrCache();

  const app = document.getElementById("app");

  function loadQrCache() {
    try {
      return JSON.parse(localStorage.getItem(QR_CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveQrCache() {
    localStorage.setItem(QR_CACHE_KEY, JSON.stringify(qrCache));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function toDate(value) {
    return String(value || "").slice(0, 10);
  }

  function formatDate(value) {
    const iso = toDate(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function eventStatus(event) {
    return toDate(event.validUntil) >= todayISO() ? "planned" : "historic";
  }

  function eventMonthKey(event) {
    const date = new Date(toDate(event.eventDate) + "T12:00:00");
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  }

  function canAdmin() {
    return user && user.role === "admin";
  }

  async function init() {
    if (!AuraApi.token()) {
      renderLogin();
      return;
    }
    try {
      const me = await AuraApi.me();
      user = me.user;
      await refreshData();
      render();
    } catch {
      AuraApi.setToken("");
      renderLogin();
    }
  }

  async function refreshData() {
    const eventResponse = await AuraApi.events();
    events = eventResponse.events || [];
    if (canAdmin()) {
      const userResponse = await AuraApi.users();
      users = userResponse.users || [];
    } else {
      users = [];
    }
  }

  function renderLogin(error = "") {
    app.className = "app-shell";
    app.innerHTML = `
      <section class="login-view">
        <div class="login-panel">
          <div class="brand-block">
            <div class="brand-kicker">Aura One&Only</div>
            <h1>Event Access Control</h1>
            <p class="muted">Sign in to manage events, QR passes, and admissions.</p>
          </div>
          <form id="loginForm" class="form-grid">
            <div class="field">
              <label for="email">Email</label>
              <input id="email" type="email" autocomplete="username" value="admin@oneonly.local" required>
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" type="password" autocomplete="current-password" value="admin123" required>
            </div>
            <button class="primary-btn" type="submit">Sign In</button>
            <div class="error">${escapeHtml(error)}</div>
          </form>
        </div>
        <div class="login-art" aria-hidden="true"></div>
      </section>
    `;
    document.getElementById("loginForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        const result = await AuraApi.login(
          document.getElementById("email").value.trim(),
          document.getElementById("password").value
        );
        AuraApi.setToken(result.token);
        user = result.user;
        await refreshData();
        activeView = "overview";
        render();
      } catch (err) {
        renderLogin(err.message);
      }
    });
  }

  function render() {
    const nav = [
      ["overview", "Overview"],
      ["events", "Events"],
      ["qr", "QR Generator"],
      ...(canAdmin() ? [["users", "Users"]] : [])
    ];
    app.className = "app-shell dashboard";
    app.innerHTML = `
      <aside class="sidebar">
        <div>
          <div class="brand-kicker">Aura One&Only</div>
          <h1>Admin Console</h1>
          <span class="role-badge">${escapeHtml(user.role)}</span>
        </div>
        <nav class="nav-list">
          ${nav.map(([id, label]) => `<button class="nav-btn ${activeView === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}
        </nav>
        <div class="hint-box">${escapeHtml(user.displayName)}<br>${escapeHtml(user.email)}</div>
        <button id="logoutBtn" class="secondary-btn">Sign Out</button>
      </aside>
      <section class="content">${renderContent()}</section>
    `;
    document.querySelectorAll(".nav-btn").forEach(button => {
      button.addEventListener("click", () => {
        activeView = button.dataset.view;
        render();
      });
    });
    document.getElementById("logoutBtn").addEventListener("click", () => {
      AuraApi.setToken("");
      user = null;
      renderLogin();
    });
    bindActions();
  }

  function renderContent() {
    if (activeView === "users" && canAdmin()) return renderUsers();
    if (activeView === "events") return renderEvents();
    if (activeView === "qr") return renderQr();
    return renderOverview();
  }

  function renderOverview() {
    const planned = events.filter(event => eventStatus(event) === "planned");
    const historic = events.length - planned.length;
    return `
      <div class="topbar">
        <div>
          <h2>Dashboard</h2>
          <p class="muted">${canAdmin() ? "All events across organizers." : "Your planned and historic events."}</p>
        </div>
        <button class="primary-btn" data-action="go-events">Create Event</button>
      </div>
      <div class="stats-grid">
        <div class="stat"><div class="stat-value">${events.length}</div><div class="stat-label">Events</div></div>
        <div class="stat"><div class="stat-value">${planned.length}</div><div class="stat-label">Planned</div></div>
        <div class="stat"><div class="stat-value">${historic}</div><div class="stat-label">Historic</div></div>
        <div class="stat"><div class="stat-value">${events.reduce((sum, event) => sum + event.admittedCount, 0)}</div><div class="stat-label">Admitted</div></div>
      </div>
      <div class="table-panel">
        <div class="table-head"><h3>Upcoming Events</h3><span class="chip planned">${planned.length} planned</span></div>
        ${renderEventsTable(planned)}
      </div>
    `;
  }

  function renderEvents() {
    return `
      <div class="topbar">
        <div>
          <h2>Events</h2>
          <p class="muted">Create events and edit their validity period as schedules change.</p>
        </div>
      </div>
      <div class="panel-grid">
        <form id="eventForm" class="panel form-grid">
          <h3>Create Event</h3>
          <div class="field"><label for="eventName">Event Name</label><input id="eventName" required></div>
          <div class="field"><label for="eventDate">Event Date</label><input id="eventDate" type="date" required></div>
          <div class="field"><label for="expirationDate">Expiration Date</label><input id="expirationDate" type="date" required></div>
          ${canAdmin() ? `<div class="field"><label for="eventOwner">Owner</label><select id="eventOwner">${users.map(item => `<option value="${item.id}">${escapeHtml(item.displayName)} (${escapeHtml(item.role)})</option>`).join("")}</select></div>` : ""}
          <button class="primary-btn" type="submit">Create Event</button>
        </form>
        <div class="table-panel">
          <div class="table-head">
            <h3>Planned And Historic Events</h3>
            <span class="chip">${events.length} total</span>
          </div>
          ${renderEventsByMonth(events, true)}
        </div>
      </div>
    `;
  }

  function renderEventsByMonth(rows, showActions = false) {
    if (!rows.length) return `<div class="empty-state">No events to show.</div>`;
    const sorted = [...rows].sort((a, b) => toDate(a.eventDate).localeCompare(toDate(b.eventDate)));
    const groups = new Map();
    sorted.forEach(event => {
      const key = eventMonthKey(event);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    });
    return [...groups.entries()].map(([month, monthEvents]) => `
      <div class="month-group">
        <div class="month-title">${escapeHtml(month)}</div>
        ${renderEventsTable(monthEvents, showActions)}
      </div>
    `).join("");
  }

  function renderEventsTable(rows, showActions = false) {
    if (!rows.length) return `<div class="empty-state">No events to show.</div>`;
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Date</th><th>Expires</th><th>Status</th><th>Owner</th><th>QR</th>${showActions ? "<th>Actions</th>" : ""}</tr></thead>
          <tbody>
            ${rows.map(event => {
              const status = eventStatus(event);
              return `
                <tr>
                  <td><button class="link-btn" data-action="open-qr" data-public-id="${event.publicId}">${escapeHtml(event.name)}</button></td>
                  <td>${escapeHtml(formatDate(event.eventDate))}</td>
                  <td>${escapeHtml(formatDate(event.validUntil))}</td>
                  <td><span class="chip ${status}">${status}</span></td>
                  <td>${escapeHtml(event.ownerName || "")}</td>
                  <td>${event.tokenCount}</td>
                  ${showActions ? `<td><div class="split-actions"><button class="secondary-btn" data-action="edit-event" data-public-id="${event.publicId}">Edit</button><button class="danger-btn" data-action="delete-event" data-public-id="${event.publicId}">Delete</button></div></td>` : ""}
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderQr() {
    const selected = events.find(event => event.publicId === activeQrPublicId) || events[0];
    activeQrPublicId = selected ? selected.publicId : null;
    if (!selected) return `<div class="empty-state">Create an event before generating QR codes.</div>`;
    const cached = qrCache[selected.publicId] || [];
    const counts = selected.countsByCapacity || {};
    return `
      <div class="topbar">
        <div>
          <h2>QR Generator</h2>
          <p class="muted">Counts are final desired totals. Increasing a group adds new QR codes; decreasing removes unused QR codes only.</p>
        </div>
      </div>
      <div class="panel-grid qr-layout">
        <form id="qrGeneratorForm" class="panel form-grid">
          <h3>Invitee Allocation</h3>
          <div class="field">
            <label for="qrEventId">Event</label>
            <select id="qrEventId">${events.map(event => `<option value="${event.publicId}" ${event.publicId === selected.publicId ? "selected" : ""}>${escapeHtml(event.name)} - ${escapeHtml(formatDate(event.eventDate))}</option>`).join("")}</select>
          </div>
          <div class="capacity-grid">
            ${[1, 2, 3, 4, 5].map(capacity => `<div class="field capacity-field"><label for="cap${capacity}">${capacity} ${capacity === 1 ? "Guest" : "Guests"}</label><input id="cap${capacity}" type="number" min="0" step="1" value="${Number(counts[capacity] || counts[String(capacity)] || 0)}"></div>`).join("")}
          </div>
          <div class="split-actions">
            <button class="primary-btn" type="submit">Apply Group Counts</button>
            <button class="secondary-btn" type="button" data-action="download-qr-zip">Download Latest ZIP</button>
          </div>
          <div id="qrSummary" class="hint-box">Lower a group count to remove unused QR codes for cancellations or errors. Codes with admissions are protected.</div>
        </form>
        <div class="table-panel qr-preview-panel">
          <div class="table-head"><h3>Generated Guest Passes</h3><span id="qrCountChip" class="chip">${cached.length} cached</span></div>
          <div id="qrPreview" class="qr-preview"></div>
        </div>
      </div>
    `;
  }

  function renderUsers() {
    return `
      <div class="topbar">
        <div><h2>Users</h2><p class="muted">Create users who can add their own events.</p></div>
      </div>
      <div class="panel-grid">
        <form id="userForm" class="panel form-grid">
          <h3>Create User</h3>
          <div class="field"><label for="userName">Full Name</label><input id="userName" required></div>
          <div class="field"><label for="userEmail">Email</label><input id="userEmail" type="email" required></div>
          <div class="field"><label for="userPassword">Temporary Password</label><input id="userPassword" required minlength="8"></div>
          <div class="field"><label for="userRole">Role</label><select id="userRole"><option value="event_user">Event User</option><option value="admin">Admin</option></select></div>
          <button class="primary-btn" type="submit">Create User</button>
        </form>
        <div class="table-panel">
          <div class="table-head"><h3>Users</h3><span class="chip">${users.length} users</span></div>
          <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>${users.map(item => `<tr><td>${escapeHtml(item.displayName)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.role)}</td><td>${item.isActive ? "Active" : "Inactive"}</td></tr>`).join("")}</tbody></table></div>
        </div>
      </div>
    `;
  }

  function bindActions() {
    document.querySelector("[data-action='go-events']")?.addEventListener("click", () => {
      activeView = "events";
      render();
    });

    document.querySelectorAll("[data-action='open-qr']").forEach(button => {
      button.addEventListener("click", () => {
        activeQrPublicId = button.dataset.publicId;
        activeView = "qr";
        render();
        renderQrPreview();
      });
    });

    document.querySelectorAll("[data-action='edit-event']").forEach(button => {
      button.addEventListener("click", async () => {
        const event = events.find(item => item.publicId === button.dataset.publicId);
        const name = prompt("Event name", event.name);
        if (name === null) return;
        const eventDate = prompt("Event date (YYYY-MM-DD)", toDate(event.eventDate));
        if (eventDate === null) return;
        const expirationDate = prompt("Expiration date (YYYY-MM-DD)", toDate(event.validUntil));
        if (expirationDate === null) return;
        try {
          await AuraApi.updateEvent(event.publicId, { name, eventDate, expirationDate });
          await refreshData();
          showToast("Event updated.");
          render();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    document.querySelectorAll("[data-action='delete-event']").forEach(button => {
      button.addEventListener("click", async () => {
        const event = events.find(item => item.publicId === button.dataset.publicId);
        if (!event) return;
        if (!confirm(`Delete event "${event.name}"? This will also remove its QR codes and check-ins.`)) return;
        try {
          await AuraApi.deleteEvent(event.publicId);
          delete qrCache[event.publicId];
          saveQrCache();
          await refreshData();
          showToast("Event deleted.");
          render();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    document.getElementById("eventForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const eventDate = document.getElementById("eventDate").value;
      const expirationDate = document.getElementById("expirationDate").value;
      if (expirationDate < eventDate) {
        showToast("Expiration date cannot be before event date.");
        return;
      }
      try {
        await AuraApi.createEvent({
          name: document.getElementById("eventName").value.trim(),
          eventDate,
          expirationDate,
          ownerUserId: canAdmin() ? document.getElementById("eventOwner").value : undefined
        });
        await refreshData();
        showToast("Event created.");
        render();
      } catch (err) {
        showToast(err.message);
      }
    });

    document.getElementById("userForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await AuraApi.createUser({
          displayName: document.getElementById("userName").value.trim(),
          email: document.getElementById("userEmail").value.trim(),
          password: document.getElementById("userPassword").value,
          role: document.getElementById("userRole").value
        });
        await refreshData();
        showToast("User created.");
        render();
      } catch (err) {
        showToast(err.message);
      }
    });

    const qrForm = document.getElementById("qrGeneratorForm");
    if (qrForm) {
      renderQrPreview();
      document.getElementById("qrEventId").addEventListener("change", () => {
        activeQrPublicId = document.getElementById("qrEventId").value;
        render();
        renderQrPreview();
      });
      qrForm.addEventListener("submit", async event => {
        event.preventDefault();
        const publicId = document.getElementById("qrEventId").value;
        const counts = {};
        [1, 2, 3, 4, 5].forEach(capacity => {
          counts[capacity] = Math.max(0, parseInt(document.getElementById(`cap${capacity}`).value, 10) || 0);
        });
        try {
          const result = await AuraApi.generateQr(publicId, counts);
          qrCache[publicId] = [...(qrCache[publicId] || []), ...(result.qrEntries || [])];
          saveQrCache();
          await refreshData();
          await reconcileQrCache(publicId);
          showToast(result.qrEntries.length ? `Generated ${result.qrEntries.length} new QR codes.` : "QR group counts updated.");
          activeQrPublicId = publicId;
          render();
          renderQrPreview();
        } catch (err) {
          showToast(err.message);
        }
      });
      document.querySelector("[data-action='download-qr-zip']")?.addEventListener("click", downloadQrZip);
    }
  }

  function renderQrPreview() {
    const event = events.find(item => item.publicId === activeQrPublicId) || events[0];
    const preview = document.getElementById("qrPreview");
    const summary = document.getElementById("qrSummary");
    if (!event || !preview || !summary) return;
    const cached = qrCache[event.publicId] || [];
    summary.innerHTML = `Event ID: <strong>${escapeHtml(event.publicId)}</strong><br>Newly generated cached QR available for ZIP: <strong>${cached.length}</strong>`;
    if (!cached.length) {
      preview.innerHTML = `<div class="empty-state">No newly generated QR codes cached in this browser session.</div>`;
      return;
    }
    preview.innerHTML = [1, 2, 3, 4, 5].map(capacity => {
      const group = cached.filter(entry => entry.capacity === capacity);
      if (!group.length) return "";
      return `<section class="qr-group"><div class="qr-group-title">${capacity} ${capacity === 1 ? "Guest" : "Guests"} <span class="chip">${group.length}</span></div><div class="qr-grid">${group.map(entry => `<article class="qr-card"><div class="qr-canvas" data-token="${entry.qrToken}"></div><div class="qr-token">${escapeHtml(entry.qrToken)}</div><div class="qr-meta">Max ${entry.capacity} pax</div><div class="qr-meta">Backup ${escapeHtml(entry.backupCode)}</div></article>`).join("")}</div></section>`;
    }).join("");
    document.querySelectorAll(".qr-canvas").forEach(node => {
      const entry = cached.find(item => item.qrToken === node.dataset.token);
      if (entry && typeof QRCode !== "undefined") {
        new QRCode(node, { text: entry.payload, width: 128, height: 128, colorDark: "#24211c", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      }
    });
  }

  async function reconcileQrCache(publicId) {
    const cached = qrCache[publicId] || [];
    if (!cached.length) return;
    try {
      const response = await AuraApi.qrTokens(publicId);
      const activeCodes = new Set((response.tokens || []).map(token => token.displayCode));
      qrCache[publicId] = cached.filter(entry => activeCodes.has(entry.qrToken));
      saveQrCache();
    } catch {
      // Keep cached ZIP data if the token-list refresh fails.
    }
  }

  async function downloadQrZip() {
    const event = events.find(item => item.publicId === activeQrPublicId) || events[0];
    const entries = event ? (qrCache[event.publicId] || []) : [];
    if (!event || !entries.length || typeof JSZip === "undefined" || typeof QRCode === "undefined") {
      showToast("No cached QR codes available to download.");
      return;
    }
    const zip = new JSZip();
    const rows = [["event_id", "event_name", "qr_token", "backup_code", "capacity", "payload"]];
    for (const entry of entries) {
      const folder = zip.folder(entry.capacity === 1 ? "1 Guest" : `${entry.capacity} Guests`);
      const holder = document.createElement("div");
      holder.style.position = "fixed";
      holder.style.left = "-9999px";
      document.body.appendChild(holder);
      new QRCode(holder, { text: entry.payload, width: 512, height: 512, colorDark: "#24211c", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      await new Promise(resolve => setTimeout(resolve, 20));
      const canvas = holder.querySelector("canvas");
      if (canvas) folder.file(`qr_${entry.qrToken}_cap${entry.capacity}.png`, canvas.toDataURL("image/png").split(",")[1], { base64: true });
      holder.remove();
      rows.push([event.publicId, event.name, entry.qrToken, entry.backupCode, entry.capacity, entry.payload]);
    }
    zip.file("manifest.csv", rows.map(row => row.map(csvCell).join(",")).join("\n"));
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${event.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_qr_codes.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function showToast(message) {
    document.querySelector(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  init();
})();
