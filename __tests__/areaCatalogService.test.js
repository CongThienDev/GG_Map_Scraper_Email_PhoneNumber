const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAreaCatalogService } = require("../app/services/areaCatalogService");

describe("areaCatalogService", () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "area-catalog-test-"));
    const dataDir = path.join(rootDir, "data", "vietnam");
    fs.mkdirSync(path.join(dataDir, "boundaries"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "catalog.json"),
      JSON.stringify({
        importedAt: "2026-01-01T00:00:00.000Z",
        source: "test",
        areas: [
          {
            id: "osm-r1",
            name: "Đà Nẵng",
            level: 4,
            geometry: { type: "MultiPolygon", coordinates: [] },
          },
          {
            id: "osm-r2",
            name: "Hải Châu",
            parentId: "osm-r1",
            parentName: "Đà Nẵng",
            level: 6,
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [108, 16],
                    [109, 16],
                    [109, 17],
                    [108, 16],
                  ],
                ],
              ],
            },
          },
        ],
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(dataDir, "boundaries", "osm-r2.json"), "{}", "utf8");
  });

  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  test("lists filterable crawl areas without sending geometry in the index", () => {
    const service = createAreaCatalogService({ rootDir });
    expect(service.status()).toMatchObject({ ready: true, provinces: 1, crawlAreas: 1 });
    expect(service.listAreas({ provinceId: "osm-r1" })).toEqual([
      expect.objectContaining({ id: "osm-r2", name: "Hải Châu" }),
    ]);
    expect(service.listAreas({ q: "hai chau" })).toHaveLength(1);
    expect(service.listAreas({ q: "Hải" })).toHaveLength(1);
    expect(service.geoJson({ provinceId: "osm-r1" }).features[0].geometry.type).toBe(
      "MultiPolygon"
    );
    expect(service.polygonPathFor(service.getAreasByIds(["osm-r2"])[0])).toMatch(/osm-r2\.json$/);
  });
});
