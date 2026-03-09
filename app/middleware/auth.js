const rateLimit = require("express-rate-limit");

function createAuth({ idleTimeoutMs }) {
  const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function requireAuth(req, res, next) {
    if (req.path.startsWith("/login")) return next();
    if (!req.session?.auth) return res.redirect("/login");

    const now = Date.now();
    const last = req.session.auth.lastSeen || now;
    if (now - last > idleTimeoutMs) {
      req.session.destroy(() => res.redirect("/login"));
      return;
    }

    req.session.auth.lastSeen = now;
    next();
  }

  return {
    loginLimiter,
    requireAuth,
  };
}

module.exports = {
  createAuth,
};
