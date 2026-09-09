const fs = require("fs");
const path = require("path");

function createAreaCatalogService({
  rootDir,
  countryCode = "VN",
  dataDirectory = "vietnam",
  sortLocale = "vi",
}) {
  const catalogPath = path.join(rootDir, "data", dataDirectory, "catalog.json");
  const boundaryDir = path.join(rootDir, "data", dataDirectory, "boundaries");
  let cached = null;
  let cachedMtimeMs = 0;

  const normalizeSearch = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLocaleLowerCase("vi");

  function readCatalog() {
    try {
      const stat = fs.statSync(catalogPath);
      if (cached && stat.mtimeMs === cachedMtimeMs) return cached;
      const value = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
      cached = Array.isArray(value.areas) ? value : { version: 1, areas: [] };
      cachedMtimeMs = stat.mtimeMs;
      return cached;
    } catch {
      cached = { version: 1, areas: [] };
      cachedMtimeMs = 0;
      return cached;
    }
  }

  function status() {
    const catalog = readCatalog();
    const areas = catalog.areas || [];
    return {
      countryCode,
      ready: areas.length > 0,
      importedAt: catalog.importedAt || null,
      source: catalog.source || null,
      totalAreas: areas.length,
      provinces: areas.filter((area) => area.level === 4).length,
      crawlAreas: areas.filter((area) => area.level === 6).length,
    };
  }

  function provinces() {
    return readCatalog()
      .areas.filter((area) => area.level === 4)
      .map(({ id, name, nameEn, areaKm2 }) => ({ id, name, nameEn, areaKm2 }))
      .sort((a, b) => a.name.localeCompare(b.name, sortLocale));
  }

  function listAreas({ provinceId = "", q = "", includeProvinces = false } = {}) {
    const query = normalizeSearch(q.trim());
    return readCatalog()
      .areas.filter((area) => includeProvinces || area.level === 6)
      .filter((area) => !provinceId || area.parentId === provinceId || area.id === provinceId)
      .filter((area) => {
        if (!query) return true;
        return normalizeSearch(
          `${area.name} ${area.nameEn || ""} ${area.parentName || ""}`
        ).includes(query);
      })
      .map((area) => {
        const summary = { ...area };
        delete summary.geometry;
        return summary;
      })
      .sort((a, b) => a.name.localeCompare(b.name, sortLocale));
  }

  function geoJson({ provinceId = "", ids = [] } = {}) {
    const wanted = new Set(ids.filter(Boolean));
    const areas = readCatalog().areas.filter((area) => {
      if (wanted.size) return wanted.has(area.id);
      return area.level === 6 && (!provinceId || area.parentId === provinceId);
    });
    return {
      type: "FeatureCollection",
      features: areas.map((area) => ({
        type: "Feature",
        id: area.id,
        properties: {
          id: area.id,
          name: area.name,
          nameEn: area.nameEn || "",
          parentId: area.parentId || "",
          parentName: area.parentName || "",
          level: area.level,
          areaKm2: area.areaKm2 || null,
        },
        geometry: area.geometry,
      })),
    };
  }

  function getAreasByIds(ids) {
    const byId = new Map(readCatalog().areas.map((area) => [area.id, area]));
    return ids.map((id) => byId.get(id)).filter((area) => area && area.level === 6);
  }

  function polygonPathFor(area) {
    if (!area || !/^[a-z0-9-]+$/i.test(area.id)) return null;
    const filePath = path.join(boundaryDir, `${area.id}.json`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  return { status, provinces, listAreas, geoJson, getAreasByIds, polygonPathFor };
}

module.exports = { createAreaCatalogService };
