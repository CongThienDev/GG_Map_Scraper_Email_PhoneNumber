const fs = require("fs");
const path = require("path");

function createJobStore({ persistencePath } = {}) {
  const jobs = new Map();
  const queue = [];
  const jsonFileCache = new Map();
  let jobSeq = 1;

  function persist() {
    if (!persistencePath) return;
    const savedJobs = Array.from(jobs.values()).map(
      ({ child: _child, logs: _logs, ...job }) => job
    );
    const tmpPath = `${persistencePath}.tmp`;
    fs.mkdirSync(path.dirname(persistencePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify({ jobs: savedJobs, jobSeq }, null, 2), "utf8");
    fs.renameSync(tmpPath, persistencePath);
  }

  function restore() {
    if (!persistencePath || !fs.existsSync(persistencePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(persistencePath, "utf8"));
      const savedJobs = Array.isArray(saved.jobs) ? saved.jobs : [];
      for (const job of savedJobs) {
        if (!job?.id || !job?.env || !job?.resultsPaths) continue;
        job.logs = [];
        if (["running", "stopping", "queued"].includes(job.status)) {
          job.status = "interrupted";
          job.lastError =
            "Server đã khởi động lại khi job đang chạy. Có thể tiếp tục từ checkpoint.";
        }
        jobs.set(String(job.id), job);
      }
      const largestId = savedJobs.reduce((max, job) => Math.max(max, Number(job?.id) || 0), 0);
      jobSeq = Math.max(Number(saved.jobSeq) || 1, largestId + 1);
      persist();
    } catch (error) {
      console.error("[JOB STORE] Không thể đọc jobs đã lưu:", error.message);
    }
  }

  restore();

  function nextJobId() {
    const id = String(jobSeq++);
    persist();
    return id;
  }

  function addJob(job) {
    jobs.set(job.id, job);
    persist();
  }

  function getJob(id) {
    return jobs.get(id);
  }

  function deleteJob(id) {
    jobs.delete(id);
    persist();
  }

  function allJobs() {
    return Array.from(jobs.values());
  }

  function pushQueue(id) {
    queue.push(id);
    persist();
  }

  function shiftQueue() {
    const id = queue.shift();
    persist();
    return id;
  }

  function removeFromQueue(id) {
    const idx = queue.indexOf(id);
    if (idx !== -1) queue.splice(idx, 1);
    persist();
  }

  function queueLength() {
    return queue.length;
  }

  function queuePosition(id) {
    const idx = queue.indexOf(id);
    return idx === -1 ? null : idx + 1;
  }

  function readJsonCached(filePath, fallbackValue) {
    if (!filePath || !fs.existsSync(filePath)) return fallbackValue;
    try {
      const stat = fs.statSync(filePath);
      const cached = jsonFileCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.data;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      jsonFileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, data: parsed });
      return parsed;
    } catch {
      return fallbackValue;
    }
  }

  return {
    nextJobId,
    addJob,
    getJob,
    deleteJob,
    allJobs,
    pushQueue,
    shiftQueue,
    removeFromQueue,
    queueLength,
    queuePosition,
    readJsonCached,
    persist,
  };
}

module.exports = {
  createJobStore,
};
