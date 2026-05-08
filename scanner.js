(function () {
  const app = document.getElementById("scannerApp");
  const SETTINGS_KEY = "aura_scanner_settings_v1";

  let events = [];
  let checkins = [];
  let settings = loadSettings();

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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

  function selectedEvent() {
    return events.find(event => event.publicId === settings.eventPublicId) || events[0] || null;
  }

  function validityState(event) {
    if (!event) return "none";
    if (toDate(event.eventDate) > todayISO()) return "premature";
    if (toDate(event.validUntil) < todayISO()) return "expired";
    return "valid";
  }

  async function init(status = null) {
    if (!AuraApi.token()) {
      renderScannerLogin();
      return;
    }
    try {
      const response = await AuraApi.events();
      events = (response.events || []).filter(event => event.tokenCount > 0);
      if (selectedEvent()) {
        settings.eventPublicId = selectedEvent().publicId;
        saveSettings();
        await loadCheckins();
      }
      render(status);
    } catch (err) {
      AuraApi.setToken("");
      renderScannerLogin(err.message);
    }
  }

  async function loadCheckins() {
    const event = selectedEvent();
    if (!event) {
      checkins = [];
      return;
    }
    try {
      const response = await AuraApi.checkins(event.publicId);
      checkins = response.checkins || [];
    } catch {
      checkins = [];
    }
  }

  function renderScannerLogin(error = "") {
    app.innerHTML = `
      <section class="top-strip">
        <div>
          <div class="brand-kicker">Aura One&Only</div>
          <h1>Guest Admission Scanner</h1>
          <p class="muted">Enter the event code and scanner PIN supplied by the organizer.</p>
        </div>
      </section>
      <section class="panel">
        <form id="scannerLoginForm" class="form-grid">
          <div class="field">
            <label for="eventCode">Event Code</label>
            <input id="eventCode" autocomplete="off" placeholder="evt_..." required>
          </div>
          <div class="field">
            <label for="scannerPin">Scanner PIN</label>
            <input id="scannerPin" inputmode="numeric" autocomplete="off" required>
          </div>
          <div class="field">
            <label for="scannerLoginLabel">Scanner / Gate Name</label>
            <input id="scannerLoginLabel" value="${escapeHtml(settings.scannerLabel || "Gate 1")}">
          </div>
          <button class="primary-btn" type="submit">Open Scanner</button>
          <div class="empty-state">${escapeHtml(error)}</div>
        </form>
      </section>
    `;
    document.getElementById("scannerLoginForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        const result = await AuraApi.scannerLogin({
          eventPublicId: document.getElementById("eventCode").value.trim(),
          pin: document.getElementById("scannerPin").value.trim(),
          scannerLabel: document.getElementById("scannerLoginLabel").value.trim()
        });
        AuraApi.setToken(result.token);
        settings.eventPublicId = result.event.publicId;
        settings.scannerLabel = document.getElementById("scannerLoginLabel").value.trim() || result.scanner.label;
        saveSettings();
        await init({ type: "warn", title: "Scanner Ready", detail: "Scanner PIN accepted." });
      } catch (err) {
        renderScannerLogin(err.message);
      }
    });
  }

  function render(status = null) {
    const event = selectedEvent();
    const scannerLabel = settings.scannerLabel || "Gate 1";
    const validity = validityState(event);
    const statusLine = status || defaultStatus(validity);

    app.innerHTML = `
      <section class="top-strip">
        <div>
          <div class="brand-kicker">Aura One&Only</div>
          <h1>Guest Admission Scanner</h1>
          <p class="muted">Cloud validation with Zebra keyboard scan and backup-code fallback.</p>
        </div>
        <div class="split-actions"><button class="secondary-btn" id="refreshBtn">Refresh</button><button class="danger-btn" id="scannerLogoutBtn">Logout</button></div>
      </section>

      <section class="panel setup-grid">
        <div class="field">
          <label for="eventSelect">Event</label>
          <select id="eventSelect" ${events.length ? "" : "disabled"}>
            ${events.length ? events.map(item => `<option value="${item.publicId}" ${event && item.publicId === event.publicId ? "selected" : ""}>${escapeHtml(item.name)} - ${escapeHtml(formatDate(item.eventDate))}</option>`).join("") : `<option>No generated QR events</option>`}
          </select>
        </div>
        <div class="field">
          <label for="scannerLabel">Scanner</label>
          <input id="scannerLabel" value="${escapeHtml(scannerLabel)}" placeholder="e.g. Gate 1">
        </div>
        <button class="primary-btn" id="saveSetupBtn">Use Setup</button>
      </section>

      <section class="scanner-grid" style="margin-top:14px;">
        <div class="panel">
          ${renderStatus(statusLine)}
          <form id="scanForm" class="scan-row">
            <div class="field">
              <label for="scanInput">QR Token Or Backup Code</label>
              <input id="scanInput" autocomplete="off" autofocus placeholder="Scan QR or enter backup code">
            </div>
            <div class="field">
              <label for="admitCount">Admit</label>
              <select id="admitCount">${[1, 2, 3, 4, 5].map(count => `<option value="${count}">${count} ${count === 1 ? "guest" : "guests"}</option>`).join("")}</select>
            </div>
            <button class="primary-btn" type="submit">Verify</button>
          </form>
        </div>

        <aside class="panel">
          <h2>${event ? escapeHtml(event.name) : "No Event"}</h2>
          <p class="muted">${event ? `Event ID ${escapeHtml(event.publicId)} | Valid ${escapeHtml(formatDate(event.eventDate))} to ${escapeHtml(formatDate(event.validUntil))}` : "Generate QR codes from the dashboard first."}</p>
          <div class="stats-grid">
            <div class="stat"><div class="stat-value">${event ? event.tokenCount : 0}</div><div class="stat-label">QR Tokens</div></div>
            <div class="stat"><div class="stat-value">${event ? event.totalCapacity : 0}</div><div class="stat-label">Capacity</div></div>
            <div class="stat"><div class="stat-value">${event ? event.admittedCount : 0}</div><div class="stat-label">Admitted</div></div>
          </div>
          <h3>Recent Scans</h3>
          <div class="scan-actions">
            <button class="secondary-btn" id="exportResultsBtn">Export Results CSV</button>
            <button class="danger-btn" id="clearScansBtn">Clear Scans</button>
          </div>
          <div class="log-list">${renderLog()}</div>
        </aside>
      </section>
    `;

    document.getElementById("refreshBtn").addEventListener("click", () => init(statusLine));
    document.getElementById("scannerLogoutBtn").addEventListener("click", () => {
      AuraApi.setToken("");
      renderScannerLogin();
    });
    document.getElementById("saveSetupBtn").addEventListener("click", async () => {
      settings.eventPublicId = document.getElementById("eventSelect").value;
      settings.scannerLabel = document.getElementById("scannerLabel").value.trim() || "Gate 1";
      saveSettings();
      await init({ type: "warn", title: "Setup Ready", detail: "Scanner setup saved for this device." });
    });
    document.getElementById("exportResultsBtn")?.addEventListener("click", exportResults);
    document.getElementById("clearScansBtn")?.addEventListener("click", clearScans);
    document.getElementById("scanForm").addEventListener("submit", eventSubmit => {
      eventSubmit.preventDefault();
      processScan();
    });
    const input = document.getElementById("scanInput");
    input.focus();
  }

  function defaultStatus(validity) {
    if (validity === "premature") return { type: "bad", title: "Not Valid Yet", detail: "This event is not open for admission yet." };
    if (validity === "expired") return { type: "bad", title: "Event Expired", detail: "This event is outside its validity period." };
    return { type: "", title: "Awaiting Scan", detail: "Scan a QR pass or enter a 6-digit backup code." };
  }

  function renderStatus(status) {
    return `<div class="status-box ${escapeHtml(status.type)}"><div><div class="status-result">${escapeHtml(status.title)}</div><div class="status-detail">${escapeHtml(status.detail)}</div></div></div>`;
  }

  function renderLog() {
    if (!checkins.length) return `<div class="empty-state">No scans recorded for this event.</div>`;
    return checkins.slice(0, 30).map(log => `
      <div class="log-item">
        <div class="log-top">
          <span class="token">${escapeHtml(log.display_code || "UNKNOWN")}</span>
          <span class="pill ${log.result === "admitted" ? "ok" : log.result === "partially_admitted" ? "warn" : "bad"}">${escapeHtml(log.result)}</span>
        </div>
        <div class="muted">${escapeHtml(log.message)} (${escapeHtml(log.admitted_count)} admitted)</div>
        <div class="muted">${escapeHtml(new Date(log.created_at).toLocaleString("en-GB"))} - ${escapeHtml(log.scanner_label || "Scanner")}</div>
      </div>
    `).join("");
  }

  async function processScan() {
    const event = selectedEvent();
    const validity = validityState(event);
    const scannedValue = document.getElementById("scanInput").value.trim();
    if (!event || !scannedValue) return;
    if (validity === "premature" || validity === "expired") {
      render(defaultStatus(validity));
      return;
    }
    try {
      const result = await AuraApi.checkIn({
        eventPublicId: event.publicId,
        scannerLabel: document.getElementById("scannerLabel").value.trim() || "Gate 1",
        scannedValue,
        admitCount: Number(document.getElementById("admitCount").value || 1)
      });
      const checkin = result.checkin;
      await init({
        type: checkin.result === "admitted" ? "ok" : checkin.result === "partially_admitted" ? "warn" : "bad",
        title: checkin.result === "admitted" ? "Admitted" : checkin.result.replaceAll("_", " "),
        detail: checkin.message || "Scan processed."
      });
    } catch (err) {
      await init({ type: "bad", title: "Denied", detail: err.message });
    }
  }

  async function exportResults() {
    const event = selectedEvent();
    if (!event) return;
    try {
      const response = await fetch(`${AuraApi.API_BASE}/events/${encodeURIComponent(event.publicId)}/checkins.csv`, {
        headers: { Authorization: `Bearer ${AuraApi.token()}` }
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${event.publicId}_admission_results.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      await init({ type: "bad", title: "Export Failed", detail: err.message });
    }
  }

  async function clearScans() {
    const event = selectedEvent();
    if (!event) return;
    if (AuraApi.isScannerToken()) {
      checkins = [];
      render({ type: "warn", title: "Scan List Cleared", detail: "This cleared the visible scanner list only. Admissions remain safely recorded." });
      return;
    }
    if (!confirm(`Clear scan results and reset admitted counts for "${event.name}"?`)) return;
    try {
      await AuraApi.clearCheckins(event.publicId);
      await init({ type: "warn", title: "Scans Cleared", detail: "Admission results and counts were reset." });
    } catch (err) {
      await init({ type: "bad", title: "Clear Failed", detail: err.message });
    }
  }

  init();
})();
