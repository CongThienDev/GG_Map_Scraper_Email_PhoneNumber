const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  estimateGridCount,
  estimateGridCountFromFile,
} = require("../app/utils/gridEstimator");

describe("gridEstimator", () => {
  const square = [
    [0, 0],
    [0.018, 0],
    [0.018, 0.018],
    [0, 0.018],
    [0, 0],
  ];

  test("counts the same grid intersections that fit within a saved polygon", () => {
    expect(estimateGridCount([square], 1000)).toBe(9);
    expect(estimateGridCount([square], 1000, 4)).toBe(4);
  });

  test("reads a saved polygon file and returns zero for an unreadable file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grid-estimator-"));
    const polygonPath = path.join(directory, "polygon.json");
    fs.writeFileSync(polygonPath, JSON.stringify({ city: "Test", polygon: [square] }), "utf8");

    try {
      expect(estimateGridCountFromFile(polygonPath, 1000)).toBe(9);
      expect(estimateGridCountFromFile(path.join(directory, "missing.json"), 1000)).toBe(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
