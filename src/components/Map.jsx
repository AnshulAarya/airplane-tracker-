import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  useMap
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import AircraftMarker from "./AircraftMarker";


function createAircraftGroups(aircraft, zoom) {
  const validAircraft = aircraft.filter(
    (plane) =>
      plane.latitude != null &&
      plane.longitude != null &&
      Number.isFinite(Number(plane.latitude)) &&
      Number.isFinite(Number(plane.longitude))
  );

  // At wide zoom, show one aircraft icon per grid cell.
  let gridSize;

  if (zoom <= 2) {
    gridSize = 4;
  } else if (zoom <= 3) {
    gridSize = 2;
  } else if (zoom <= 4) {
    gridSize = 0.5;
  } else if (zoom <= 5) {
    gridSize = 0.1;
  } else {
    return validAircraft.map((plane) => ({
      ...plane,
      groupSize: 1,
    }));
  }

  const groups = new globalThis.Map();

  validAircraft.forEach((plane) => {
    const latGroup = Math.floor(
      Number(plane.latitude) / gridSize
    );

    const lonGroup = Math.floor(
      Number(plane.longitude) / gridSize
    );

    const key = `${latGroup}_${lonGroup}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(plane);
  });

  // Keep one representative aircraft icon per grid cell.
  return Array.from(groups.values()).map((group) => ({
    ...group[0],
    groupSize: group.length,
  }));
}



function getVisibleAircraft(map, aircraft) {
  const zoom = map.getZoom();
  const bounds = map.getBounds();

  const visible = aircraft.filter((plane) => {
    const lat = Number(plane.latitude);
    const lon = Number(plane.longitude);

    if (
      plane.latitude == null ||
      plane.longitude == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return false;
    }

    return bounds.contains([lat, lon]);
  });

  return createAircraftGroups(visible, zoom);
}

function MapController({
  aircraft,
  setVisibleAircraft,
  setZoomLevel,
  setMapView
}) {
  const map = useMap();

  const aircraftRef = useRef(aircraft);

  aircraftRef.current = aircraft;


  // Search result -> move map to aircraft
  useEffect(() => {
    const handleFocusAircraft = (event) => {
      const plane = event.detail;

      if (
        plane?.latitude == null ||
        plane?.longitude == null
      ) {
        return;
      }

      map.flyTo(
        [
          plane.latitude,
          plane.longitude
        ],
        8,
        {
          duration: 1.5
        }
      );
    };

    window.addEventListener(
      "focus-aircraft",
      handleFocusAircraft
    );

    return () => {
      window.removeEventListener(
        "focus-aircraft",
        handleFocusAircraft
      );
    };
  }, [map]);


  // Update aircraft when backend data changes
  useEffect(() => {
    const visible =
      getVisibleAircraft(
        map,
        aircraft
      );

    setVisibleAircraft(visible);
  }, [
    aircraft,
    map,
    setVisibleAircraft
  ]);


  // Map movement and zoom
  
  // Map movement and zoom
  useEffect(() => {
    const updateMapView = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();

      setZoomLevel(zoom);

      setMapView({
        lat: center.lat,
        lon: center.lng,
        zoom,
      });

      const visible = getVisibleAircraft(
        map,
        aircraftRef.current
      );

      setVisibleAircraft(visible);
    };

    updateMapView();

    map.on("zoomend", updateMapView);
    map.on("moveend", updateMapView);

    return () => {
      map.off("zoomend", updateMapView);
      map.off("moveend", updateMapView);
    };
   }, [
    map,
    setVisibleAircraft,
    setZoomLevel,
    setMapView,
  ]);

  return null;
}
function Map() {
  const [aircraft, setAircraft] =
    useState([]);

  const [visibleAircraft, setVisibleAircraft] =
    useState([]);

  const [selectedAircraft, setSelectedAircraft] =
    useState(null);

  const [zoomLevel, setZoomLevel] =
    useState(2);
    const [mapView, setMapView] = useState({
  lat: 20,
  lon: 0,
  zoom: 2,
});  

  const [searchTerm, setSearchTerm] =
    useState("");

  const [searchMessage, setSearchMessage] =
    useState("");


 
  // Keep the latest map view available to the polling function
  const mapViewRef = useRef(mapView);

  useEffect(() => {
    mapViewRef.current = mapView;
  }, [mapView]);

  // Fetch aircraft and poll every 15 seconds
  useEffect(() => {
    let cancelled = false;
    let timeoutId;

    const fetchAircraft = async () => {
      const view = mapViewRef.current;

      try {
        const response = await fetch(
          `http://127.0.0.1:5000/api/aircraft?lat=${view.lat}&lon=${view.lon}&zoom=${view.zoom}`
        );

        if (!response.ok) {
          throw new Error(
            `Backend returned ${response.status}`
          );
        }

        const data = await response.json();

        if (!cancelled) {
        const nextAircraft = data.aircraft || [];

setAircraft((previousAircraft) =>
  previousAircraft === nextAircraft
    ? previousAircraft
    : nextAircraft
);
          console.log(
  "Aircraft sample:",
  data.source,
  data.aircraft?.slice(0, 3).map((p) => ({
    id: p.icao24,
    lat: p.latitude,
    lon: p.longitude,
    source: p.source,
  }))
);
          console.log("Total aircraft:", data.count);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Error fetching aircraft:", error);
        }
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(fetchAircraft, 15000);
        }
      }
    };

    fetchAircraft();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // Search aircraft
  const searchAircraft = () => {
    const query =
      searchTerm
        .trim()
        .toLowerCase();

    if (!query) {
      setSearchMessage(
        "Enter a callsign, registration, ICAO or aircraft type."
      );
      return;
    }

    const found =
      aircraft.find((plane) => {
        return (
          plane.callsign
            ?.toLowerCase()
            .includes(query) ||

          plane.registration
            ?.toLowerCase()
            .includes(query) ||

          plane.icao24
            ?.toLowerCase()
            .includes(query) ||

          plane.aircraftType
            ?.toLowerCase()
            .includes(query)
        );
      });


    if (!found) {
      setSearchMessage(
        "Aircraft not found."
      );
      return;
    }


    setSearchMessage("");

    setSelectedAircraft(found);


    // Tell MapController to
    // move the map
    window.dispatchEvent(
      new CustomEvent(
        "focus-aircraft",
        {
          detail: found
        }
      )
    );
  };


  return (
    <div
      style={{
        position: "relative"
      }}
    >

      {/* SEARCH BAR */}

      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "50%",
          transform:
            "translateX(-50%)",
          zIndex: 1000,
          display: "flex",
          gap: "8px",
          background: "white",
          padding: "8px",
          borderRadius: "10px",
          boxShadow:
            "0 3px 12px rgba(0,0,0,0.25)"
        }}
      >

        <input
          type="text"
          placeholder="Search aircraft..."
          value={searchTerm}
          onChange={(e) =>
            setSearchTerm(
              e.target.value
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              searchAircraft();
            }
          }}
          style={{
            width: "220px",
            padding: "10px",
            border:
              "1px solid #ccc",
            borderRadius: "6px",
            outline: "none"
          }}
        />

        <button
          onClick={
            searchAircraft
          }
          style={{
            padding:
              "10px 15px",
            border: "none",
            borderRadius: "6px",
            background:
              "#05bfc9",
            color: "white",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          Search
        </button>

      </div>


      {/* SEARCH MESSAGE */}

      {searchMessage && (
        <div
          style={{
            position: "absolute",
            top: "75px",
            left: "50%",
            transform:
              "translateX(-50%)",
            zIndex: 1000,
            background: "white",
            padding:
              "8px 14px",
            borderRadius: "8px",
            boxShadow:
              "0 2px 10px rgba(0,0,0,0.2)",
            color: "#d00"
          }}
        >
          {searchMessage}
        </div>
      )}


      <MapContainer
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        style={{
          height: "100vh",
          width: "100%"
        }}
      >

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />


        <MapController
          aircraft={aircraft}
          setVisibleAircraft={
            setVisibleAircraft
          }
          setZoomLevel={
            setZoomLevel
          }
          setMapView={setMapView}
        />


{visibleAircraft.map((plane, index) => (
  <AircraftMarker
    key={plane.icao24}
    plane={plane}
    onSelect={setSelectedAircraft}
    isSearched={
      selectedAircraft?.icao24 === plane.icao24
    }
    zoomLevel={zoomLevel}
  />
))}

      </MapContainer>


      {/* ZOOM MESSAGE */}

      {zoomLevel <= 2 && (
        <div
          style={{
            position: "absolute",
            top: "80px",
            left: "50%",
            transform:
              "translateX(-50%)",
            zIndex: 1000,
            background:
              "rgba(255,255,255,0.95)",
            padding:
              "8px 14px",
            borderRadius: "8px",
            boxShadow:
              "0 2px 10px rgba(0,0,0,0.2)",
            fontSize: "14px"
          }}
        >
          🔍 Zoom in to see more aircraft
        </div>
      )}


      {/* AIRCRAFT DETAILS */}

     {selectedAircraft && (
  <div
    style={{
      position: "absolute",
      top: "80px",
      right: "20px",
      zIndex: 1000,
      width: "320px",
      padding: "20px",
      background: "rgba(10, 18, 30, 0.96)",
      color: "white",
      borderRadius: "14px",
      border: "1px solid rgba(0, 229, 255, 0.5)",
      boxShadow:
        "0 0 20px rgba(0, 229, 255, 0.25)"
    }}
  >

    {/* CLOSE BUTTON */}

    <button
      onClick={() =>
        setSelectedAircraft(null)
      }
      style={{
        position: "absolute",
        top: "12px",
        right: "12px",
        border: "none",
        background: "transparent",
        color: "#aaa",
        fontSize: "20px",
        cursor: "pointer"
      }}
    >
      ✕
    </button>


    {/* AIRCRAFT HEADER */}

    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "15px"
      }}
    >

      <span
        style={{
          fontSize: "30px",
          color: "#00e5ff"
        }}
      >
        ✈
      </span>

      <div>
       <h2
  style={{
    margin: "0",
    color: "#00e5ff",
    fontSize: "22px"
  }}
>
  {selectedAircraft.callsign ||
    "Unknown"}
</h2>

<div
  style={{
    color: "#ccc",
    fontSize: "13px",
    marginTop: "4px"
  }}
>
  {selectedAircraft.description ||
    "Aircraft description unavailable"}
</div>
      </div>

    </div>


    <hr
      style={{
        border: "none",
        borderTop:
          "1px solid rgba(255,255,255,0.15)",
        marginBottom: "15px"
      }}
    />


    {/* BASIC INFORMATION */}

    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "1fr 1fr",
        gap: "12px",
        marginBottom: "18px"
      }}
    >

      <div>
        <div style={{ color: "#888", fontSize: "12px" }}>
          REGISTRATION
        </div>

        <div style={{ fontWeight: "bold" }}>
          {selectedAircraft.registration ||
            "Unknown"}
        </div>
      </div>


      <div>
        <div style={{ color: "#888", fontSize: "12px" }}>
          AIRCRAFT TYPE
        </div>

        <div style={{ fontWeight: "bold" }}>
          {selectedAircraft.aircraftType ||
            "Unknown"}
        </div>
      </div>


      <div>
        <div style={{ color: "#888", fontSize: "12px" }}>
          COUNTRY
        </div>

        <div style={{ fontWeight: "bold" }}>
          {selectedAircraft.country ||
            "Unknown"}
        </div>
      </div>


      <div>
        <div style={{ color: "#888", fontSize: "12px" }}>
          ICAO
        </div>

        <div style={{ fontWeight: "bold" }}>
          {selectedAircraft.icao24 ||
            "Unknown"}
        </div>
      </div>

    </div>


    {/* FLIGHT DATA */}

    <div
      style={{
        padding: "14px",
        borderRadius: "10px",
        background:
          "rgba(255,255,255,0.05)",
        marginBottom: "15px"
      }}
    >

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 1fr 1fr",
          gap: "10px",
          textAlign: "center"
        }}
      >

        <div>
          <div style={{ color: "#888", fontSize: "11px" }}>
            ALTITUDE
          </div>

          <div
            style={{
              color: "#00e5ff",
              fontWeight: "bold"
            }}
          >
            {selectedAircraft.altitude != null
              ? `${Math.round(
                  selectedAircraft.altitude
                )} m`
              : "—"}
          </div>
        </div>


        <div>
          <div style={{ color: "#888", fontSize: "11px" }}>
            SPEED
          </div>

          <div
            style={{
              color: "#00e5ff",
              fontWeight: "bold"
            }}
          >
            {selectedAircraft.velocity != null
              ? `${Math.round(
                  selectedAircraft.velocity
                )} m/s`
              : "—"}
          </div>
        </div>


        <div>
          <div style={{ color: "#888", fontSize: "11px" }}>
            HEADING
          </div>

          <div
            style={{
              color: "#00e5ff",
              fontWeight: "bold"
            }}
          >
            {selectedAircraft.heading != null
              ? `${Math.round(
                  selectedAircraft.heading
                )}°`
              : "—"}
          </div>
        </div>

      </div>

    </div>


    {/* POSITION */}

    <div>

      <div
        style={{
          color: "#888",
          fontSize: "12px",
          marginBottom: "8px"
        }}
      >
        POSITION
      </div>


      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          fontSize: "13px"
        }}
      >

        <span>
          Latitude
        </span>

        <strong>
          {selectedAircraft.latitude != null
            ? selectedAircraft.latitude.toFixed(4)
            : "—"}
        </strong>

      </div>


      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          fontSize: "13px",
          marginTop: "6px"
        }}
      >

        <span>
          Longitude
        </span>

        <strong>
          {selectedAircraft.longitude != null
            ? selectedAircraft.longitude.toFixed(4)
            : "—"}
        </strong>

      </div>

    </div>

  </div>
)}

    </div>
  );
}


export default Map;