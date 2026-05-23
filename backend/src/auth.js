import { config } from "./config.js";

export function login(req, res) {
  const { username, password } = req.body || {};

  if (username === config.auth.username && password === config.auth.password) {
    return res.json({
      success: true,
      token: config.auth.token,
      user: { username: config.auth.username },
    });
  }

  return res.status(401).json({ success: false, message: "Invalid credentials" });
}

export function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];

  if (token !== config.auth.token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return next();
}
