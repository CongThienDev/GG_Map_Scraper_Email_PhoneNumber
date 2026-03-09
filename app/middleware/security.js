const helmet = require("helmet");
const session = require("express-session");
const cookieParser = require("cookie-parser");

function applySecurityMiddleware(app, config) {
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(require("express").json());
  app.use(require("express").urlencoded({ extended: true }));

  app.use(session({
    name: "mapsui.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
    },
  }));
}

module.exports = {
  applySecurityMiddleware,
};
