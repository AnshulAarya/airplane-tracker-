
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

const GLOBAL_CACHE_MS = 15 * 60 * 1000;
const REGIONAL_CACHE_MS = 5000;
const REGIONAL_DISTANCE = 250;

const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

let openSkyToken = null;
let openSkyTokenExpiresAt = 0;
let tokenFetching = null;

let globalAircraft = [];
let globalUpdatedAt = 0;
let globalFetching = false;

const regionalCache = new Map();

function normalizeOpenSky(states = []) {
  return states
    .filter((s) => s[0] && s[5] != null && s[6] != null)
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
      velocity: typeof s[9] === "number" ? s[9] : null,
      heading: typeof s[10] === "number" ? s[10] : 0,
      registration: "Unknown",
      aircraftType: "Unknown",
      description: "Unknown",
      source: "OpenSky",
    }));
}

function normalizeAdsb(planes = []) {
  return planes
    .filter((p) => p.hex && p.lat != null && p.lon != null)
    .map((p) => ({
      icao24: p.hex,
      callsign: p.flight?.trim() || "Unknown",
      country: "Unknown",
      longitude: p.lon,
      latitude: p.lat,
      altitude:
        typeof p.alt_baro === "number" ? p.alt_baro * 0.3048 : null,
      velocity: typeof p.gs === "number" ? p.gs * 0.514444 : null,
      heading: typeof p.track === "number" ? p.track : 0,
      registration: p.r || "Unknown",
      aircraftType: p.t || "Unknown",
      description: p.desc || "Unknown",
      source: "ADSB.fi",
    }));
}

async function getOpenSkyToken() {
  if (openSkyToken && Date.now() < openSkyTokenExpiresAt) {
    return openSkyToken;
  }

  if (tokenFetching) {
    return tokenFetching;
  }

  tokenFetching = (async () => {
    try {
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.OPENSKY_CLIENT_ID,
        client_secret: process.env.OPENSKY_CLIENT_SECRET,
      });

      const response = await axios.post(
        OPENSKY_TOKEN_URL,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: 30000,
        }
      );

      openSkyToken = response.data.access_token;

      const expiresIn = response.data.expires_in || 1800;
      openSkyTokenExpiresAt =
        Date.now() + Math.max(expiresIn - 60, 60) * 1000;

      console.log("OpenSky authentication successful.");
      return openSkyToken;
    } catch (error) {
      openSkyToken = null;
      openSkyTokenExpiresAt = 0;

      console.error("OpenSky authentication failed:", {
        status: error.response?.status ?? null,
        code: error.code ?? null,
        message: error.message,
      });

      throw error;
    } finally {
      tokenFetching = null;
    }
  })();

  return tokenFetching;
}


async function refreshGlobalData() {
  if (globalFetching) return;

  globalFetching = true;

  try {
    console.log("Refreshing global aircraft data from GitHub Pages...");

    const response = await axios.get(
      "https://anshulaarya.github.io/airplane-tracker-/aircraft-snapshot.json",
      {
        timeout: 20000,
        headers: {
          "Cache-Control": "no-cache",
        },
      }
    );

    const states = response.data?.states || [];
    const aircraft = normalizeOpenSky(states);

    if (aircraft.length > 0) {
      globalAircraft = aircraft;
      globalUpdatedAt = Date.now();

      console.log(
        `OpenSky snapshot updated: ${globalAircraft.length} aircraft`
      );
    } else {
      console.warn(
        "Snapshot contains no aircraft; retaining previous cache."
      );
    }
  } catch (error) {
    console.error("Global snapshot refresh failed:", {
      status: error.response?.status ?? null,
      code: error.code ?? null,
      message: error.message,
    });
  } finally {
    globalFetching = false;
  }
}
async function getRegionalData(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = regionalCache.get(key);

  if (cached && Date.now() - cached.updatedAt < REGIONAL_CACHE_MS) {
    return cached.aircraft;
  }

  const url =
    `https://opendata.adsb.fi/api/v3/lat/${lat}` +
    `/lon/${lon}/dist/${REGIONAL_DISTANCE}`;

  try {
    const response = await axios.get(url, { timeout: 20000 });
    const aircraft = normalizeAdsb(response.data.ac || []);

    regionalCache.set(key, {
      aircraft,
      updatedAt: Date.now(),
    });

    return aircraft;
  } catch (error) {
    console.error("ADS-B.fi error:", error.response?.status || error.message);
    return cached?.aircraft || [];
  }
}

app.get("/", (req, res) => {
  res.send("Zoom-aware Airplane Tracker backend is running.");
});

app.get("/api/aircraft", async (req, res) => {
  const DEFAULT_LAT = 28.6139;
  const DEFAULT_LON = 77.209;

  const lat =
    req.query.lat !== undefined ? Number(req.query.lat) : DEFAULT_LAT;
  const lon =
    req.query.lon !== undefined ? Number(req.query.lon) : DEFAULT_LON;
  const zoom = Number(req.query.zoom ?? 2);

  if (zoom <= 3) {
    if (
      !globalUpdatedAt ||
      Date.now() - globalUpdatedAt >= GLOBAL_CACHE_MS
    ) {
      if (globalAircraft.length > 0) {
        refreshGlobalData();
      } else {
        await refreshGlobalData();
      }
    }

    if (globalAircraft.length > 0) {
      return res.json({
        count: globalAircraft.length,
        lastUpdated: new Date(globalUpdatedAt).toISOString(),
        source: "OpenSky",
        aircraft: globalAircraft,
      });
    }

    const regionalAircraft = await getRegionalData(lat, lon);

    return res.json({
      count: regionalAircraft.length,
      lastUpdated: new Date().toISOString(),
      source: "ADSB.fi fallback (regional)",
      aircraft: regionalAircraft,
    });
  }

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
  const regionalIds = new Set(regionalAircraft.map((plane) => plane.icao24));

  const aircraft = [
    ...regionalAircraft,
    ...globalAircraft.filter((plane) => !regionalIds.has(plane.icao24)),
  ];

  return res.json({
    count: aircraft.length,
    lastUpdated: new Date().toISOString(),
    source: "ADSB.fi + OpenSky",
    aircraft,
  });
});
 
app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("ZOOM-AWARE AIRPLANE TRACKER");
  console.log(`Server running on port ${PORT}`);
  console.log("================================");

  refreshGlobalData();
  setInterval(refreshGlobalData, GLOBAL_CACHE_MS);
});
