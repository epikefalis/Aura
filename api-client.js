(function () {
  const API_BASE = window.AURA_API_BASE || "/api";
  const LEGACY_TOKEN_KEY = "aura_api_token_v1";
  const USER_TOKEN_KEY = "aura_user_api_token_v1";
  const SCANNER_TOKEN_KEY = "aura_scanner_api_token_v1";

  function tokenKey() {
    return window.location.pathname.toLowerCase().includes("scanner") ? SCANNER_TOKEN_KEY : USER_TOKEN_KEY;
  }

  function token() {
    const current = localStorage.getItem(tokenKey()) || "";
    if (current) return current;
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY) || "";
    if (!legacy) return "";
    try {
      const payload = JSON.parse(atob(legacy.split(".")[0].replaceAll("-", "+").replaceAll("_", "/")));
      if (payload.kind === "scanner") {
        localStorage.setItem(SCANNER_TOKEN_KEY, legacy);
        return tokenKey() === SCANNER_TOKEN_KEY ? legacy : "";
      }
      localStorage.setItem(USER_TOKEN_KEY, legacy);
      return tokenKey() === USER_TOKEN_KEY ? legacy : "";
    } catch {
      return "";
    }
  }

  function setToken(value) {
    if (value) localStorage.setItem(tokenKey(), value);
    else {
      localStorage.removeItem(tokenKey());
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  }

  async function request(path, options = {}) {
    const headers = {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload && payload.error ? payload.error : `Request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  window.AuraApi = {
    API_BASE,
    token,
    setToken,
    isScannerToken: () => {
      const value = token();
      if (!value.includes(".")) return false;
      try {
        return JSON.parse(atob(value.split(".")[0].replaceAll("-", "+").replaceAll("_", "/"))).kind === "scanner";
      } catch {
        return false;
      }
    },
    request,
    login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
    scannerLogin: data => request("/scanner/login", { method: "POST", body: data }),
    me: () => request("/me"),
    users: () => request("/users"),
    createUser: data => request("/users", { method: "POST", body: data }),
    updateUser: (id, data) => request(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: data }),
    passwordReminder: id => request(`/users/${encodeURIComponent(id)}/password-reminder`, { method: "POST" }),
    deleteUser: id => request(`/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
    events: () => request("/events"),
    createEvent: data => request("/events", { method: "POST", body: data }),
    updateEvent: (publicId, data) => request(`/events/${encodeURIComponent(publicId)}`, { method: "PATCH", body: data }),
    deleteEvent: publicId => request(`/events/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    createScannerAccess: (publicId, data) => request(`/events/${encodeURIComponent(publicId)}/scanner-access`, { method: "POST", body: data }),
    generateQr: (publicId, counts) => request(`/events/${encodeURIComponent(publicId)}/qr/generate`, { method: "POST", body: { counts } }),
    qrTokens: publicId => request(`/events/${encodeURIComponent(publicId)}/qr`),
    checkIn: data => request("/check-in", { method: "POST", body: data }),
    checkins: publicId => request(`/events/${encodeURIComponent(publicId)}/checkins`),
    clearCheckins: publicId => request(`/events/${encodeURIComponent(publicId)}/checkins`, { method: "DELETE" })
  };
})();
