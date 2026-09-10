const fs = require("fs");

const METERS_PER_DEGREE_LATITUDE = 111320;

function metersToDegreesLatitude(meters) {
  return meters / METERS_PER_DEGREE_LATITUDE;
}

function metersToDegreesLongitude(meters, latitude) {
  return meters / (METERS_PER_DEGREE_LATITUDE * Math.cos((latitude * Math.PI) / 180));
}

function pointInRing(latitude, longitude, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLongitude, currentLatitude] = ring[index];
    const [previousLongitude, previousLatitude] = ring[previous];
    const intersects =
      currentLatitude > latitude !== previousLatitude > latitude &&
      longitude <
        ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude || 1e-12) +
          currentLongitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

function normalizePolygon(value) {
  if (!value?.polygon || !Array.isArray(value.polygon)) return [];
  return value.polygon.filter(
    (ring) =>
      Array.isArray(ring) &&
      ring.length >= 3 &&
      ring.every(
        (point) =>
          Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
      )
  );
}

function estimateGridCount(polygon, stepMeters, maxCells = 0) {
  const rings = normalizePolygon({ polygon });
  const step = Number(stepMeters);
  if (!rings.length || !Number.isFinite(step) || step <= 0) return 0;

  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  for (const ring of rings) {
    for (const [longitude, latitude] of ring) {
      minLongitude = Math.min(minLongitude, Number(longitude));
      maxLongitude = Math.max(maxLongitude, Number(longitude));
      minLatitude = Math.min(minLatitude, Number(latitude));
      maxLatitude = Math.max(maxLatitude, Number(latitude));
    }
  }

  const latitudeStep = metersToDegreesLatitude(step);
  const longitudeStep = metersToDegreesLongitude(step, (minLatitude + maxLatitude) / 2);
  let count = 0;
  for (let latitude = minLatitude; latitude <= maxLatitude + 1e-9; latitude += latitudeStep) {
    for (let longitude = minLongitude; longitude <= maxLongitude + 1e-9; longitude += longitudeStep) {
      if (!rings.some((ring) => pointInRing(latitude, longitude, ring))) continue;
      count += 1;
      if (maxCells > 0 && count >= maxCells) return maxCells;
    }
  }
  return count;
}

function estimateGridCountFromFile(polygonPath, stepMeters, maxCells = 0) {
  if (!polygonPath || !fs.existsSync(polygonPath)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(polygonPath, "utf8"));
    return estimateGridCount(parsed?.polygon, stepMeters, maxCells);
  } catch {
    return 0;
  }
}

module.exports = { estimateGridCount, estimateGridCountFromFile };
