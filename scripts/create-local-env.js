#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const rootDir = path.resolve(__dirname, "..");
const examplePath = path.join(rootDir, ".env.example");
const envPath = path.join(rootDir, ".env");
const username = String(process.env.MAPS_SETUP_ADMIN_USER || "").trim();
const password = String(process.env.MAPS_SETUP_ADMIN_PASSWORD || "");
const maxConcurrent = Number.parseInt(process.env.MAPS_SETUP_MAX_CONCURRENT || "2", 10);

if (!username) throw new Error("Missing administrator username.");
if (password.length < 8) throw new Error("Administrator password must have at least 8 characters.");
if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
  throw new Error("MAX_CONCURRENT must be a positive integer.");
}
if (!fs.existsSync(examplePath)) throw new Error(".env.example was not found.");
if (fs.existsSync(envPath)) throw new Error(".env already exists; refusing to overwrite it.");

const adminHash = bcrypt.hashSync(password, 12);
const sessionSecret = crypto.randomBytes(32).toString("hex");
let output = fs.readFileSync(examplePath, "utf8");

function setValue(key, value) {
  const matcher = new RegExp(`^${key}=.*$`, "m");
  output = matcher.test(output)
    ? output.replace(matcher, `${key}=${value}`)
    : `${output.trimEnd()}\n${key}=${value}\n`;
}

setValue("SESSION_SECRET", sessionSecret);
setValue("ADMIN_USER", username);
setValue("ADMIN_HASH", adminHash);
setValue("MAX_CONCURRENT", String(maxConcurrent));
setValue("PROXY_ENABLED", "false");
setValue("BLOCK_ASSETS", "true");

fs.writeFileSync(envPath, output, { encoding: "utf8", mode: 0o600 });
console.log(`Created .env with MAX_CONCURRENT=${maxConcurrent}, direct connection, and asset blocking enabled.`);
