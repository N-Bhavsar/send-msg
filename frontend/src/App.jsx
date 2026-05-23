import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  fetchRecords,
  deleteRecord,
  loginApi,
  runReminderCheck,
  uploadFile,
} from "./api";

function isAuthenticated() {
  return localStorage.getItem("authToken") === "demo-admin-token";
}

function normalizePhoneForWhatsApp(phoneNumber) {
  return String(phoneNumber || "").trim().replace(/\D/g, "");
}

function buildReminderMessage(record) {
  const expiryText = new Date(record.expiryDate).toISOString().slice(0, 10);
  const vehicleNumber = record.vehicleNumber || record.vehicleNo || "UNKNOWN";
  return (
    `Hello ${record.name},\n` +
    `This is a reminder that the insurance for your VEHICAL NO (${vehicleNumber}) is about to expire on ${expiryText}.\n` +
    "Please renew your insurance on time."
  );
}

function buildWhatsAppSendUrl(record) {
  const phone = normalizePhoneForWhatsApp(record.phoneNumber);
  const text = buildReminderMessage(record);
  const query = new URLSearchParams({ phone, text });
  return `https://web.whatsapp.com/send?${query.toString()}`;
}

function openWhatsAppTab(record) {
  const url = buildWhatsAppSendUrl(record);
  const tab = window.open(url, "_blank", "noopener,noreferrer");

  if (tab) {
    tab.focus();
    window.setTimeout(() => {
      try {
        tab.close();
      } catch {
        // Ignore browser restrictions.
      }
    }, 10000);
  }

  return Boolean(tab);
}

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await loginApi(username, password);
      localStorage.setItem("authToken", data.token);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page login-page">
      <div className="card auth-card">
        <h1>Expiry Reminder</h1>
        <p className="subtitle">Sign in with admin credentials to continue</p>

        <form onSubmit={onSubmit} className="form">
          <label>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="admin123"
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningReminder, setRunningReminder] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const summary = useMemo(() => {
    const now = new Date();
    let near = 0;
    let expired = 0;

    records.forEach((r) => {
      const expiry = new Date(r.expiryDate);
      const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        expired += 1;
      } else if (diffDays <= 3) {
        near += 1;
      }
    });

    return { total: records.length, near, expired };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const now = new Date();

    return records.filter((record) => {
      if (query) {
        const haystack = `${record.name} ${record.phoneNumber}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      if (statusFilter === "all") {
        return true;
      }

      const expiry = new Date(record.expiryDate);
      const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

      if (statusFilter === "expired") {
        return diffDays < 0;
      }

      if (statusFilter === "near") {
        return diffDays >= 0 && diffDays <= 3;
      }

      return true;
    });
  }, [records, searchQuery, statusFilter]);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/", { replace: true });
      return;
    }

    loadRecords();
  }, [navigate]);

  async function loadRecords() {
    try {
      const data = await fetchRecords();
      setRecords(data);
    } catch (err) {
      if (err.message.toLowerCase().includes("unauthorized")) {
        localStorage.removeItem("authToken");
        navigate("/", { replace: true });
      } else {
        setError(err.message);
      }
    }
  }

  async function handleUpload() {
    if (!file) {
      setError("Please select a .xlsx or .csv file first.");
      return;
    }

    setError("");
    setStatus("");
    setLoading(true);

    try {
      const result = await uploadFile(file);
      setStatus(`${result.message}. Parsed rows: ${result.count}`);
      await loadRecords();
      setFile(null);
      document.getElementById("upload-input").value = "";
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunReminderCheck() {
    setError("");
    setStatus("");
    setRunningReminder(true);

    try {
      const result = await runReminderCheck();
      setStatus(`Reminder run finished. Sent: ${result.sentCount}, Skipped: ${result.skippedCount}`);
      await loadRecords();
    } catch (err) {
      setError(err.message || "Reminder run failed");
    } finally {
      setRunningReminder(false);
    }
  }

  async function handleSendNow(row) {
    setError("");
    setStatus("");
    const opened = openWhatsAppTab(row);

    if (opened) {
      setStatus(`Opened WhatsApp tab for ${row.name}. Send the message, then the tab will close automatically.`);
    } else {
      setError("Popup blocked. Allow popups for this site and try again.");
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete ${row.name}?`)) {
      return;
    }

    setError("");
    setStatus("");
    setDeletingRecordId(String(row.id));

    try {
      await deleteRecord(row.id);
      setStatus("Record deleted.");
      await loadRecords();
    } catch (err) {
      setError(err.message || "Failed to delete record");
    } finally {
      setDeletingRecordId("");
    }
  }

  async function handleSendWhatsAppWeb() {
    setError("");
    setStatus("");
    setSendingWeb(true);

    try {
      const result = await sendWhatsAppWeb(file);
      setStatus(
        `WhatsApp Web done. Sent: ${result.sentCount}, Failed: ${result.failedCount}`
      );
      await loadRecords();
    } catch (err) {
      setError(err.message || "WhatsApp Web send failed");
    } finally {
      setSendingWeb(false);
    }
  }

  async function handleSendNearExpiry() {
    setError("");
    setStatus("");
    const now = new Date();
    const openedRecords = records.filter((record) => {
      const expiry = new Date(record.expiryDate);
      if (Number.isNaN(expiry.getTime())) {
        return false;
      }

      const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 3;
    });

    let openedCount = 0;
    for (const record of openedRecords) {
      if (openWhatsAppTab(record)) {
        openedCount += 1;
      }
    }

    if (openedCount > 0) {
      setStatus(`Opened ${openedCount} WhatsApp tab(s) for near-expiry reminders.`);
    } else {
      setError("Popup blocked or no near-expiry records were found.");
    }
  }

  function logout() {
    localStorage.removeItem("authToken");
    navigate("/", { replace: true });
  }

  return (
    <div className="page dashboard-page">
      <div className="card dashboard-card">
        <div className="dashboard-topbar">
          <div>
            <h1>Dashboard</h1>
            <p className="subtitle">Upload Excel/CSV and track expiry reminders</p>
          </div>
          <button className="ghost-btn" onClick={logout}>
            Logout
          </button>
        </div>

        <div className="stats-grid">
          <div className="stat-box">
            <span>Total Contacts</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="stat-box">
            <span>Near Expiry (3 days)</span>
            <strong>{summary.near}</strong>
          </div>
          <div className="stat-box">
            <span>Expired</span>
            <strong>{summary.expired}</strong>
          </div>
        </div>

        <div className="direct-wa-panel">
          <div>
            <strong>Direct WhatsApp mode</strong>
            <p>Each send action opens WhatsApp in a new tab, then closes it automatically after a short delay.</p>
          </div>
        </div>

        <div className="upload-row">
          <input
            id="upload-input"
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button onClick={handleUpload} disabled={loading}>
            {loading ? "Uploading..." : "Upload File"}
          </button>
          <button onClick={handleSendNearExpiry}>
            Open WhatsApp Tabs (Near Expiry)
          </button>
        </div>

        {status ? <p className="ok">{status}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="filter-row">
          <input
            type="search"
            placeholder="Search name or phone"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All records</option>
            <option value="near">Near expiry (3 days)</option>
            <option value="expired">Expired</option>
          </select>
          <div className="filter-count">
            Showing {filteredRecords.length} of {records.length}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone Number</th>
                <th>Expiry Date</th>
                <th>Last Reminder</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty">
                    No records match your search. Upload a file to begin.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.phoneNumber}</td>
                    <td>{new Date(row.expiryDate).toLocaleDateString("en-IN")}</td>
                    <td>{row.lastReminderSentOn || "Not sent"}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="table-btn"
                          onClick={() => handleSendNow(row)}
                        >
                          Open WhatsApp
                        </button>
                        <button
                          className="table-btn danger-btn"
                          onClick={() => handleDelete(row)}
                          disabled={deletingRecordId === String(row.id)}
                        >
                          {deletingRecordId === String(row.id) ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
