import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  fetchRecords,
  deleteRecord,
  fetchWhatsAppQr,
  fetchWhatsAppStatus,
  loginApi,
  runReminderCheck,
  sendReminderNow,
  sendWhatsAppWeb,
  sendWhatsAppWebNearExpiry,
  uploadFile,
} from "./api";

function isAuthenticated() {
  return localStorage.getItem("authToken") === "demo-admin-token";
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
  const [sendingRecordId, setSendingRecordId] = useState("");
  const [deletingRecordId, setDeletingRecordId] = useState("");
  const [sendingWeb, setSendingWeb] = useState(false);
  const [sendingNearExpiry, setSendingNearExpiry] = useState(false);
  const [whatsAppStatus, setWhatsAppStatus] = useState(null);
  const [whatsAppQr, setWhatsAppQr] = useState("");
  const [whatsAppLoading, setWhatsAppLoading] = useState(false);
  const [showQr, setShowQr] = useState(false);
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
    loadWhatsAppStatus();
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

  async function loadWhatsAppStatus() {
    try {
      const status = await fetchWhatsAppStatus();
      setWhatsAppStatus(status);
    } catch (err) {
      setWhatsAppStatus({ status: "error", message: err.message });
    }
  }

  async function handleShowQr() {
    setWhatsAppLoading(true);
    setError("");

    try {
      const result = await fetchWhatsAppQr();
      setWhatsAppQr(result.qr || "");
      setShowQr(true);
    } catch (err) {
      setError(err.message || "Failed to load WhatsApp QR");
    } finally {
      setWhatsAppLoading(false);
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
    setSendingRecordId(String(row.id));

    try {
      const result = await sendReminderNow(row.id);
      setStatus(result.message || `Reminder sent to ${row.name}`);
      await loadRecords();
      await loadWhatsAppStatus();
    } catch (err) {
      setError(err.message || "Failed to send reminder");
    } finally {
      setSendingRecordId("");
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
      setStatus(`WhatsApp Web done. Sent: ${result.sentCount}, Failed: ${result.failedCount}`);
      await loadRecords();
      await loadWhatsAppStatus();
    } catch (err) {
      setError(err.message || "WhatsApp Web send failed");
    } finally {
      setSendingWeb(false);
    }
  }

  async function handleSendNearExpiry() {
    setError("");
    setStatus("");
    setSendingNearExpiry(true);

    try {
      const result = await sendWhatsAppWebNearExpiry();
      setStatus(`WhatsApp Web done. Sent: ${result.sentCount}, Failed: ${result.failedCount}`);
      await loadRecords();
      await loadWhatsAppStatus();
    } catch (err) {
      setError(err.message || "WhatsApp Web send failed");
    } finally {
      setSendingNearExpiry(false);
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
          <button onClick={handleShowQr} disabled={whatsAppLoading}>
            {whatsAppLoading ? "Loading QR..." : "Connect WhatsApp"}
          </button>
          <button onClick={handleSendNearExpiry} disabled={sendingNearExpiry}>
            {sendingNearExpiry ? "Sending..." : "Send All (Near Expiry)"}
          </button>
        </div>

        {whatsAppStatus?.status ? (
          <p className="status-pill">
            WhatsApp: {whatsAppStatus.status}
          </p>
        ) : null}

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
                          disabled={sendingRecordId === String(row.id)}
                        >
                          {sendingRecordId === String(row.id) ? "Sending..." : "Send Now"}
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

      {showQr ? (
        <div className="modal">
          <div className="modal-card">
            <div className="modal-header">
              <h2>Scan WhatsApp QR</h2>
              <button className="ghost-btn" onClick={() => setShowQr(false)}>
                Close
              </button>
            </div>
            {whatsAppQr ? (
              <img className="qr-image" src={whatsAppQr} alt="WhatsApp QR" />
            ) : (
              <p className="muted">QR not ready. Click refresh.</p>
            )}
            <div className="modal-actions">
              <button onClick={handleShowQr} disabled={whatsAppLoading}>
                Refresh QR
              </button>
              <button className="ghost-btn" onClick={loadWhatsAppStatus}>
                Check status
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
