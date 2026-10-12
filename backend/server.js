const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const PORT = 5000;

// OpenSky anonymous quota is limited.
// Cache global data for 15 minutes.
const GLOBAL_CACHE_MS = 15 * 60 * 1000;

// ADS-B.fi public API: maximum 250 NM per request.
const REGIONAL_CACHE_MS = 1;
const REGIONAL_DISTANCE = 250;

let globalAircraft = [];
let globalUpdatedAt = 0;
let globalFetching = false;

const regionalCache = new Map();

function normalizeOpenSky(states = []) {
  return states
    .filter(
      (s) =>
        s[0] &&
        s[5] != null &&
        s[6] != null
    )
    .map((s) => ({
      icao24: s[0],
      callsign: s[1]?.trim() || "Unknown",
      country: s[2] || "Unknown",
      longitude: s[5],
      latitude: s[6],
      altitude:
        typeof s[7] === "number"
          ? s[7]
          : typeof s[13] === "number"
            ? s[13]
            : null,
      velocity:
        typeof s[9] === "number"
          ? s[9]
          : null,
      heading:
        typeof s[10] === "number"
          ? s[10]
          : 0,
      registration: "Unknown",
      aircraftType: "Unknown",
      description: "Unknown",
      source: "OpenSky",
    }));
}

function normalizeAdsb(planes = []) {
  return planes
    .filter(
      (p) =>
        p.hex &&
        p.lat != null &&
        p.lon != null
    )
    .map((p) => ({
      icao24: p.hex,
      callsign: p.flight?.trim() || "Unknown",
      country: "Unknown",
      longitude: p.lon,
      latitude: p.lat,
      altitude:
        typeof p.alt_baro === "number"
          ? p.alt_baro * 0.3048
          : null,
      velocity:
        typeof p.gs === "number"
          ? p.gs * 0.514444
          : null,
      heading:
        typeof p.track === "number"
          ? p.track
          : 0,
      registration: p.r || "Unknown",
      aircraftType: p.t || "Unknown",
      description: p.desc || "Unknown",
      source: "ADSB.fi",
    }));
}

async function refreshGlobalData() {
  if (globalFetching) return;

  globalFetching = true;

  try {
    console.log("Refreshing OpenSky global snapshot...");

    const response = await axios.get(
      "https://opensky-network.org/api/states/all",
      { timeout: 25000 }
    );

    globalAircraft = normalizeOpenSky(
      response.data.states || []
    );

    globalUpdatedAt = Date.now();

    console.log(
      `OpenSky updated: ${globalAircraft.length} aircraft`
    );
  } catch (error) {
    console.error(
      "OpenSky error:",
      error.response?.status || error.message
    );

    // Keep the last successful snapshot.
  } finally {
    globalFetching = false;
  }
}

async function getRegionalData(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = regionalCache.get(key);

  if (
    cached &&
    Date.now() - cached.updatedAt < REGIONAL_CACHE_MS
  ) {
    return cached.aircraft;
  }

  const url =
    `https://opendata.adsb.fi/api/v3/lat/${lat}` +
    `/lon/${lon}/dist/${REGIONAL_DISTANCE}`;

  try {
    const response = await axios.get(url, {
      timeout: 20000,
    });

    const aircraft = normalizeAdsb(
      response.data.ac || []
    );

    regionalCache.set(key, {
      aircraft,
      updatedAt: Date.now(),
    });

    return aircraft;
  } catch (error) {
    console.error(
      "ADS-B.fi error:",
      error.response?.status || error.message
    );

    // Use stale regional data if available.
    return cached?.aircraft || [];
  }
}

app.get("/", (req, res) => {
  res.send("Zoom-aware Airplane Tracker backend is running.");
});

app.get("/api/aircraft", async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const zoom = Number(req.query.zoom ?? 2);

  // World view: use the cached global snapshot.
  if (zoom <= 3) {
    if (
      !globalUpdatedAt ||
      Date.now() - globalUpdatedAt >= GLOBAL_CACHE_MS
    ) {
      // Return cached data immediately while refreshing
      // in the background if we already have a snapshot.
      if (globalAircraft.length) {
        refreshGlobalData();
      } else {
        await refreshGlobalData();
      }
    }

    return res.json({
      count: globalAircraft.length,
      lastUpdated: globalUpdatedAt
        ? new Date(globalUpdatedAt).toISOString()
        : null,
      source: "OpenSky",
      aircraft: globalAircraft,
    });
  }

  // Close view: request local ADS-B.fi data.
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({
      error: "Valid lat and lon query parameters are required at zoom > 3.",
    });
  }

const regionalAircraft = await getRegionalData(lat, lon);

// Prefer fresh regional data when the same aircraft
// appears in both sources.
const regionalIds = new Set(
  regionalAircraft.map((plane) => plane.icao24)
);

const aircraft = [
  ...regionalAircraft,
  ...globalAircraft.filter(
    (plane) => !regionalIds.has(plane.icao24)
  ),
];

res.json({
  count: aircraft.length,
  lastUpdated: new Date().toISOString(),
  source: "ADSB.fi + OpenSky",
  aircraft,
});
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("================================");
  console.log("ZOOM-AWARE AIRPLANE TRACKER");
  console.log(`http://127.0.0.1:${PORT}`);
  console.log("================================");

  // Load global data at startup.
  refreshGlobalData();

  // Refresh the global snapshot every 15 minutes.
  setInterval(
    refreshGlobalData,
    GLOBAL_CACHE_MS
  );
});