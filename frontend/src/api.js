const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

export function getToken() {
  return localStorage.getItem("authToken") || "";
}

function authHeaders() {
  return {
    "x-auth-token": getToken(),//sfdc
  };
}

export async function loginApi(username, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Login failed");
  }
  return data;
}

export async function fetchRecords() {
  const res = await fetch(`${API_BASE}/records`, {
    headers: authHeaders(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Failed to fetch records");
  }
  return data;
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Upload failed");
  }
  return data;
}

export async function runReminderCheck() {
  const res = await fetch(`${API_BASE}/reminders/run`, {
    method: "POST",
    headers: authHeaders(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Failed to run reminder check");
  }
  return data;
}

export async function sendReminderNow(recordId) {
  const res = await fetch(`${API_BASE}/reminders/${recordId}/send`, {
    method: "POST",
    headers: authHeaders(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Failed to send reminder");
  }
  return data;
}

export async function deleteRecord(recordId) {
  const res = await fetch(`${API_BASE}/records/${recordId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Failed to delete record");
  }
  return data;
}

export async function sendWhatsAppWeb(file) {
  const formData = new FormData();
  if (file) {
    formData.append("file", file);
  }

  const res = await fetch(`${API_BASE}/whatsapp-web/send`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "WhatsApp Web send failed");
  }
  return data;
}

export async function sendWhatsAppWebNearExpiry() {
  const res = await fetch(`${API_BASE}/whatsapp-web/send-near-expiry`, {
    method: "POST",
    headers: authHeaders(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "WhatsApp Web send failed");
  }
  return data;
}
