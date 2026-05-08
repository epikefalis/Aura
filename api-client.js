(function () {
  const API_BASE = window.AURA_API_BASE || "/api";
  const TOKEN_KEY = "aura_api_token_v1";

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(value) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
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
    request,
    login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
    me: () => request("/me"),
    users: () => request("/users"),
    createUser: data => request("/users", { method: "POST", body: data }),
    events: () => request("/events"),
    createEvent: data => request("/events", { method: "POST", body: data }),
    updateEvent: (publicId, data) => request(`/events/${encodeURIComponent(publicId)}`, { method: "PATCH", body: data }),
    deleteEvent: publicId => request(`/events/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    generateQr: (publicId, counts) => request(`/events/${encodeURIComponent(publicId)}/qr/generate`, { method: "POST", body: { counts } }),
    qrTokens: publicId => request(`/events/${encodeURIComponent(publicId)}/qr`),
    checkIn: data => request("/check-in", { method: "POST", body: data }),
    checkins: publicId => request(`/events/${encodeURIComponent(publicId)}/checkins`),
    clearCheckins: publicId => request(`/events/${encodeURIComponent(publicId)}/checkins`, { method: "DELETE" })
  };
})();
