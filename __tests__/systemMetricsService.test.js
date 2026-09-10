const path = require("path");
const { createSystemMetricsService } = require("../app/services/systemMetricsService");

function fakeStatfs() {
  return { bsize: 1024n, blocks: 100n, bavail: 25n };
}

describe("systemMetricsService", () => {
  test("uses a native macOS snapshot without pretending it is a container", () => {
    let now = 1_000;
    const service = createSystemMetricsService({
      rootDir: "/project",
      platform: "darwin",
      clock: () => now,
      cpus: () => [
        { times: { user: now, nice: 0, sys: 0, idle: now, irq: 0 } },
        { times: { user: now, nice: 0, sys: 0, idle: now, irq: 0 } },
      ],
      totalmem: () => 8_000,
      freemem: () => 3_000,
      getMacMemoryAvailablePercent: () => 37.5,
      statfs: fakeStatfs,
      cacheMs: 0,
    });

    const first = service.snapshot();
    now = 2_000;
    const second = service.snapshot();

    expect(first.host.scope).toBe("local");
    expect(first.application.status).toBe("unavailable");
    expect(second.host.cpuPercent).toBe(50);
    expect(second.host.disk).toEqual({ totalBytes: 102_400, availableBytes: 25_600 });
  });

  test("reads cgroup v2 usage, memory and OOM counters on Linux", () => {
    let now = 1_000;
    const cgroupRoot = "/cgroup";
    const files = {
      "/proc/self/cgroup": "0::/\n",
      [path.join(cgroupRoot, "cpu.stat")]: "usage_usec 1000000\n",
      [path.join(cgroupRoot, "cpu.max")]: "100000 100000\n",
      [path.join(cgroupRoot, "memory.current")]: "512\n",
      [path.join(cgroupRoot, "memory.max")]: "1024\n",
      [path.join(cgroupRoot, "memory.events")]: "high 2\noom_kill 1\n",
      [path.join(cgroupRoot, "cpu.pressure")]: "some avg10=1.20 avg60=0.00 avg300=0.00 total=0\n",
      [path.join(cgroupRoot, "memory.pressure")]:
        "some avg10=0.40 avg60=0.00 avg300=0.00 total=0\n",
      [path.join(cgroupRoot, "io.pressure")]: "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
    };
    const service = createSystemMetricsService({
      rootDir: "/project",
      platform: "linux",
      cgroupRoot,
      clock: () => now,
      exists: (filename) => filename === path.join(cgroupRoot, "cgroup.controllers"),
      readFile: (filename) => {
        if (!(filename in files)) throw new Error("missing file");
        return files[filename];
      },
      statfs: fakeStatfs,
      cacheMs: 0,
    });

    const first = service.snapshot();
    now = 2_000;
    files[path.join(cgroupRoot, "cpu.stat")] = "usage_usec 1500000\n";
    const second = service.snapshot();

    expect(first.host.status).toBe("unavailable");
    expect(first.application.cpuPercent).toBeNull();
    expect(second.application.cpuPercent).toBe(50);
    expect(second.application.memory).toEqual({ currentBytes: 512, maxBytes: 1024 });
    expect(second.application.events).toEqual({ oomKills: 1, high: 2 });
    expect(second.application.pressure.cpuSomeAvg10).toBe(1.2);
  });

  test("marks an old VPS collector snapshot as stale", () => {
    const rootDir = "/project";
    const service = createSystemMetricsService({
      rootDir,
      platform: "linux",
      clock: () => 50_000,
      exists: () => false,
      readFile: (filename) => {
        if (filename === path.join(rootDir, "data", "system-metrics.json")) {
          return JSON.stringify({ collectedAt: new Date(1).toISOString() });
        }
        throw new Error("missing file");
      },
    });

    expect(service.snapshot().host.status).toBe("stale");
  });
});
