const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function createPolygonService({ rootDir }) {
  const polygonJobs = new Map();
  let polySeq = 1;

  function spawnPolygonJob({ cities, country }) {
    const id = String(polySeq++);
    const listPath = path.join(rootDir, `polylist_${Date.now()}_${id}.txt`);
    fs.writeFileSync(listPath, cities.join("\n"), "utf8");

    const child = spawn(
      "node",
      [path.join(rootDir, "scripts", "fetch_polygons_batch.js"), "--file", listPath],
      {
        env: { ...process.env, COUNTRY: country || "" },
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const job = { id, status: "running", logs: [], listPath, child };
    polygonJobs.set(id, job);

    const pushLog = (line, stream = "stdout") => {
      const entry = `[${new Date().toISOString()}] [${stream}] ${line}`;
      job.logs.push(entry);
      if (job.logs.length > 1500) job.logs.splice(0, job.logs.length - 500);
    };

    child.stdout.on("data", (buf) => pushLog(buf.toString(), "stdout"));
    child.stderr.on("data", (buf) => pushLog(buf.toString(), "stderr"));
    child.on("exit", (code) => {
      job.status = code === 0 ? "finished" : "failed";
      pushLog(`Process exited with code ${code}`, "exit");
      try {
        fs.unlinkSync(listPath);
      } catch {
        // ignore
      }
    });

    return job;
  }

  function createJob(body) {
    const text = (body.citiesText || "").toString().trim();
    const country = (body.country || "").toString().trim();
    const list = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return { error: "Thiếu danh sách city" };

    const job = spawnPolygonJob({ cities: list, country });
    return { job };
  }

  function getJob(id) {
    return polygonJobs.get(id);
  }

  return {
    createJob,
    getJob,
  };
}

module.exports = {
  createPolygonService,
};
