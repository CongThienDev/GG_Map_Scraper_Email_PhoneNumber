const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_CACHE_MS = 5_000;
const HOST_SNAPSHOT_MAX_AGE_MS = 20_000;

function readText(readFile, filename) {
  try {
    return readFile(filename, "utf8").trim();
  } catch {
    return null;
  }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseKeyValue(text) {
  if (!text) return {};
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim().split(/\s+/, 2))
      .filter(([key, value]) => key && value)
  );
}

function parsePressure(text) {
  const some = text
    ?.split("\n")
    .find((line) => line.startsWith("some "))
    ?.match(/avg10=([\d.]+)/);
  return some ? number(some[1]) : null;
}

function cpuTotals(cpus) {
  return cpus.reduce(
    (total, cpu) => {
      const times = cpu.times || {};
      total.idle += Number(times.idle || 0);
      total.total += Object.values(times).reduce((sum, value) => sum + Number(value || 0), 0);
      return total;
    },
    { idle: 0, total: 0 }
  );
}

function macMemoryAvailablePercent() {
  try {
    const output = execFileSync("memory_pressure", ["-Q"], { encoding: "utf8", timeout: 1_000 });
    const match = output.match(/memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
    return match ? number(match[1]) : null;
  } catch {
    return null;
  }
}

function usagePercent(previous, current) {
  if (!previous || current.total <= previous.total) return null;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100));
}

function cgroupDirectory(readFile, cgroupRoot) {
  const line = readText(readFile, "/proc/self/cgroup")
    ?.split("\n")
    .find((entry) => entry.startsWith("0::"));
  if (!line) return null;
  const relativePath = line.slice(3) || "/";
  return path.join(cgroupRoot, relativePath);
}

function statFs(statfs, directory) {
  try {
    const value = statfs(directory, { bigint: true });
    const blockSize = value.bsize;
    return {
      totalBytes: Number(value.blocks * blockSize),
      availableBytes: Number(value.bavail * blockSize),
    };
  } catch {
    return null;
  }
}

function createSystemMetricsService({
  rootDir,
  getJobStats = () => null,
  clock = () => Date.now(),
  platform = process.platform,
  readFile = fs.readFileSync,
  exists = fs.existsSync,
  statfs = fs.statfsSync,
  cpus = os.cpus,
  totalmem = os.totalmem,
  freemem = os.freemem,
  getMacMemoryAvailablePercent = macMemoryAvailablePercent,
  availableParallelism = os.availableParallelism,
  cgroupRoot = "/sys/fs/cgroup",
  cacheMs = DEFAULT_CACHE_MS,
}) {
  let cache = null;
  let previousHostCpu = null;
  let previousContainerCpu = null;

  const hostSnapshotPath = path.join(rootDir, "data", "system-metrics.json");

  function readHostSnapshot(now) {
    const raw = readText(readFile, hostSnapshotPath);
    if (!raw) return { status: "unavailable", reason: "Host collector chưa được cấu hình." };
    try {
      const snapshot = JSON.parse(raw);
      const collectedAtMs = Date.parse(snapshot.collectedAt || "");
      if (!Number.isFinite(collectedAtMs) || now - collectedAtMs > HOST_SNAPSHOT_MAX_AGE_MS) {
        return { status: "stale", reason: "Số liệu VPS đã quá 20 giây." };
      }
      return { status: "available", ...snapshot };
    } catch {
      return { status: "unavailable", reason: "Không đọc được snapshot VPS." };
    }
  }

  function nativeHost(now) {
    const currentCpu = cpuTotals(cpus());
    const cpuPercent = usagePercent(previousHostCpu, currentCpu);
    previousHostCpu = currentCpu;
    const totalBytes = totalmem();
    const macAvailablePercent = platform === "darwin" ? getMacMemoryAvailablePercent() : null;
    const availableBytes =
      macAvailablePercent === null
        ? freemem()
        : Math.round(totalBytes * (macAvailablePercent / 100));
    return {
      status: "available",
      scope: platform === "darwin" ? "local" : "host",
      collectedAt: new Date(now).toISOString(),
      cpuPercent,
      cpuCores: cpus().length,
      memory: {
        totalBytes,
        availableBytes,
        usedBytes: Math.max(0, totalBytes - availableBytes),
      },
      disk: statFs(statfs, rootDir),
      pressure: { cpuSomeAvg10: null, memorySomeAvg10: null, ioSomeAvg10: null },
    };
  }

  function containerMetrics(now) {
    if (platform !== "linux" || !exists(path.join(cgroupRoot, "cgroup.controllers"))) {
      return { status: "unavailable", reason: "Không chạy trong Linux cgroup v2." };
    }

    const directory = cgroupDirectory(readFile, cgroupRoot);
    if (!directory)
      return { status: "unavailable", reason: "Không xác định được cgroup ứng dụng." };

    const cpuStat = parseKeyValue(readText(readFile, path.join(directory, "cpu.stat")));
    const usageUsec = number(cpuStat.usage_usec);
    const cpuMax = (readText(readFile, path.join(directory, "cpu.max")) || "").split(/\s+/);
    const quota = cpuMax[0] === "max" ? null : number(cpuMax[0]);
    const period = number(cpuMax[1]);
    const cpuCores = quota && period ? quota / period : Math.max(1, availableParallelism?.() || 1);
    const currentCpu = usageUsec === null ? null : { usageUsec, at: now };
    let cpuPercent = null;
    if (previousContainerCpu && currentCpu && now > previousContainerCpu.at) {
      cpuPercent = Math.max(
        0,
        Math.min(
          100,
          ((currentCpu.usageUsec - previousContainerCpu.usageUsec) /
            1000 /
            (now - previousContainerCpu.at) /
            cpuCores) *
            100
        )
      );
    }
    previousContainerCpu = currentCpu;

    const memoryCurrentBytes = number(readText(readFile, path.join(directory, "memory.current")));
    const memoryMaxRaw = readText(readFile, path.join(directory, "memory.max"));
    const memoryMaxBytes = memoryMaxRaw === "max" ? null : number(memoryMaxRaw);
    const memoryEvents = parseKeyValue(readText(readFile, path.join(directory, "memory.events")));

    return {
      status: "available",
      cpuPercent,
      cpuCores,
      memory: {
        currentBytes: memoryCurrentBytes,
        maxBytes: memoryMaxBytes,
      },
      events: {
        oomKills: number(memoryEvents.oom_kill) || 0,
        high: number(memoryEvents.high) || 0,
      },
      pressure: {
        cpuSomeAvg10: parsePressure(readText(readFile, path.join(directory, "cpu.pressure"))),
        memorySomeAvg10: parsePressure(readText(readFile, path.join(directory, "memory.pressure"))),
        ioSomeAvg10: parsePressure(readText(readFile, path.join(directory, "io.pressure"))),
      },
    };
  }

  function snapshot() {
    const now = clock();
    if (cache && now - cache.createdAt < cacheMs) return cache.value;

    const host = platform === "linux" ? readHostSnapshot(now) : nativeHost(now);
    const value = {
      collectedAt: new Date(now).toISOString(),
      host,
      application: containerMetrics(now),
      jobs: getJobStats(),
    };
    cache = { createdAt: now, value };
    return value;
  }

  return { snapshot };
}

module.exports = { createSystemMetricsService };
