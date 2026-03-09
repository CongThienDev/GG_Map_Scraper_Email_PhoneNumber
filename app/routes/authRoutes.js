const express = require("express");
const bcrypt = require("bcrypt");

function createAuthRoutes({ adminUser, adminHash, loginLimiter }) {
  const router = express.Router();

  router.get("/login", (req, res) => {
    if (req.session?.auth) return res.redirect("/");
    res.type("html").send(`<!doctype html><meta charset="utf-8">
      <title>Login</title>
      <style>
        body{font-family:system-ui;display:grid;place-items:center;height:100vh;background:#f6f7fb;margin:0}
        form{background:#fff;padding:24px;border-radius:12px;box-shadow:0 6px 28px rgba(0,0,0,.08);min-width:320px}
        h2{margin:0 0 12px 0} input,button{width:100%;padding:10px;margin:6px 0;border:1px solid #ddd;border-radius:8px}
        button{cursor:pointer}
      </style>
      <form method="post" action="/login">
        <h2>Maps Scan Login</h2>
        <input name="username" placeholder="Username" required>
        <input name="password" type="password" placeholder="Password" required>
        <button type="submit">Sign in</button>
      </form>
    `);
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (username !== adminUser) return res.status(401).send("Unauthorized");

    try {
      const ok = await bcrypt.compare(password, adminHash);
      if (!ok) return res.status(401).send("Unauthorized");
    } catch {
      return res.status(401).send("Unauthorized");
    }

    req.session.auth = { username: adminUser, loginAt: Date.now(), lastSeen: Date.now() };
    res.redirect("/");
  });

  router.post("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
  });

  return router;
}

module.exports = {
  createAuthRoutes,
};
