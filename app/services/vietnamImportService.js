const path = require("path");
const { spawn } = require("child_process");

function createVietnamImportService({ rootDir }) {
  let job = null;

  function start() {
    if (job?.status === "running") return { job, alreadyRunning: true };
    const child = spawn("node", [path.join(rootDir, "scripts", "import_vietnam_areas.js")], {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    job = { id: String(Date.now()), status: "running", logs: [], child };
    const log = (chunk, stream) => {
      job.logs.push(`[${new Date().toISOString()}] [${stream}] ${chunk.toString()}`);
      if (job.logs.length > 1000) job.logs.splice(0, job.logs.length - 500);
    };
    child.stdout.on("data", (chunk) => log(chunk, "stdout"));
    child.stderr.on("data", (chunk) => log(chunk, "stderr"));
    child.on("exit", (code) => {
      job.status = code === 0 ? "finished" : "failed";
      log(`Process exited with code ${code}`, "exit");
    });
    return { job, alreadyRunning: false };
  }

  function getJob(id) {
    return job && job.id === id ? job : null;
  }
  return { start, getJob };
}

function createUnitedStatesImportService({ rootDir }) {
  let job = null;

  function start() {
    if (job?.status === "running") return { job, alreadyRunning: true };
    const child = spawn("node", [path.join(rootDir, "scripts", "import_vietnam_areas.js")], {
      cwd: rootDir,
      env: { ...process.env, AREA_IMPORT_COUNTRY: "US" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    job = { id: String(Date.now()), status: "running", logs: [], child };
    const log = (chunk, stream) => {
      job.logs.push(`[${new Date().toISOString()}] [${stream}] ${chunk.toString()}`);
      if (job.logs.length > 1000) job.logs.splice(0, job.logs.length - 500);
    };
    child.stdout.on("data", (chunk) => log(chunk, "stdout"));
    child.stderr.on("data", (chunk) => log(chunk, "stderr"));
    child.on("exit", (code) => {
      job.status = code === 0 ? "finished" : "failed";
      log(`Process exited with code ${code}`, "exit");
    });
    return { job, alreadyRunning: false };
  }

  function getJob(id) {
    return job && job.id === id ? job : null;
  }

  return { start, getJob };
}

module.exports = { createVietnamImportService, createUnitedStatesImportService };
