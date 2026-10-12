
import { memo, useEffect, useMemo, useRef } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";

const toRadians = (degrees) => (degrees * Math.PI) / 180;

function predictPosition(plane, seconds) {
  const lat = Number(plane.latitude);
  const lng = Number(plane.longitude);
  const speed = Number(plane.velocity);
  const heading = Number(plane.heading);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(speed) ||
    !Number.isFinite(heading)
  ) {
    return { lat, lng };
  }

  // velocity is expected in metres per second.
  const distance = Math.max(0, speed) * seconds;
  const bearing = toRadians(heading);
  const latRadians = toRadians(lat);

  const nextLat =
    lat + (distance * Math.cos(bearing)) / 111320;

  const longitudeScale = 111320 * Math.cos(latRadians);
  const nextLng =
    Math.abs(longitudeScale) > 1
      ? lng + (distance * Math.sin(bearing)) / longitudeScale
      : lng;

  return { lat: nextLat, lng: nextLng };
}

function AircraftMarker({
  plane,
  onSelect,
  isSearched,
  zoomLevel = 2,
}) {
  const markerRef = useRef(null);

  // Freeze the React Leaflet position prop at initial mount.
  const initialPositionRef = useRef({
    lat: Number(plane.latitude),
    lng: Number(plane.longitude),
  });

  const planeRef = useRef(plane);
  const reportTimeRef = useRef(performance.now());
  const displayedRef = useRef(null);

  const isGroup = plane.groupSize > 1;
  const heading = Number(plane.heading ?? 0);

  const iconSize =
    zoomLevel <= 2 ? 12 :
    zoomLevel <= 3 ? 16 :
    zoomLevel <= 4 ? 20 :
    26;

  const color = isSearched ? "#00e5ff" : "red";

  const icon = useMemo(
    () =>
      L.divIcon({
        className: "aircraft-icon",
        html: `<div style="
          transform: rotate(${heading - 90}deg);
          width: ${iconSize}px;
          height: ${iconSize}px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${color};
          text-shadow: 0 0 2px white;
          line-height: 1;
          font-size: ${iconSize}px;
        ">✈</div>`,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconSize / 2, iconSize / 2],
      }),
    [heading, iconSize, color]
  );

  // Save each new report without directly moving the marker.
  useEffect(() => {
    const lat = Number(plane.latitude);
    const lng = Number(plane.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    planeRef.current = plane;
    reportTimeRef.current = performance.now();
  }, [plane.latitude, plane.longitude, plane.velocity, plane.heading]);

  // Run one continuous animation loop for this mounted marker.
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const start = marker.getLatLng();
    displayedRef.current = { lat: start.lat, lng: start.lng };

    let frameId;
    let running = true;
    let previousTime = performance.now();

    const animate = (now) => {
      if (!running) return;

      const dt = Math.min((now - previousTime) / 1000, 0.1);
      previousTime = now;

      const currentPlane = planeRef.current;
      const displayed = displayedRef.current;

      if (displayed && currentPlane) {
        // Predict forward from the most recent reported coordinates.
        const elapsed = Math.min(
          (now - reportTimeRef.current) / 1000,
          15
        );

        const predicted = predictPosition(currentPlane, elapsed);

        // Smoothly correct toward the predicted position.
        const alpha = 1 - Math.exp(-dt / 0.9);

        const lat =
          displayed.lat + (predicted.lat - displayed.lat) * alpha;
        const lng =
          displayed.lng + (predicted.lng - displayed.lng) * alpha;

        displayedRef.current = { lat, lng };
        marker.setLatLng([lat, lng]);
      }

      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(frameId);
    };
  }, []);

  const initial = initialPositionRef.current;

  return (
    <Marker
      ref={markerRef}
      position={[initial.lat, initial.lng]}
      icon={icon}
      eventHandlers={{
        click: () => {
          if (isGroup) {
            window.dispatchEvent(
              new CustomEvent("focus-aircraft", {
                detail: plane.groupedAircraft?.[0] ?? plane,
              })
            );
          } else {
            onSelect?.(plane);
          }
        },
      }}
    />
  );
}

export default memo(AircraftMarker);