const fs = require("fs");

function createJobStore() {
  const jobs = new Map();
  const queue = [];
  const jsonFileCache = new Map();
  let jobSeq = 1;

  function nextJobId() {
    return String(jobSeq++);
  }

  function addJob(job) {
    jobs.set(job.id, job);
  }

  function getJob(id) {
    return jobs.get(id);
  }

  function deleteJob(id) {
    jobs.delete(id);
  }

  function allJobs() {
    return Array.from(jobs.values());
  }

  function pushQueue(id) {
    queue.push(id);
  }

  function shiftQueue() {
    return queue.shift();
  }

  function removeFromQueue(id) {
    const idx = queue.indexOf(id);
    if (idx !== -1) queue.splice(idx, 1);
  }

  function queueLength() {
    return queue.length;
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
    readJsonCached,
  };
}

module.exports = {
  createJobStore,
};
