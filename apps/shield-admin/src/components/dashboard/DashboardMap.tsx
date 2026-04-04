import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L, { LatLngExpression } from "leaflet";
import { PiBusBold, PiMapPinFill, PiStudentBold } from "react-icons/pi";

import type {
  Bus,
  BusEtaPrediction,
  BusLocation,
  RouteStop,
  Student,
} from "../../supabase";
import type { DashboardTabId } from "./DashboardSidebar";
import {
  formatTime,
  getConfidenceMeta,
  getSavedMapView,
  MAP_STORAGE_KEY,
  toNumber,
} from "./dashboard-utils";

interface DashboardMapProps {
  defaultCenter: LatLngExpression;
  defaultZoom: number;
  activeTab: DashboardTabId;
  followLiveTracking: boolean;
  followCenter: [number, number] | null;
  mapClickActive: boolean;
  mapFocus: [number, number] | null;
  onMapClick: ((lat: number, lng: number, address: string) => void) | null;
  onMapDrag?: () => void;
  activeBuses: BusLocation[];
  inactiveFleetMarkers: InactiveFleetMarker[];
  fleetList: Bus[];
  etaByBus: Record<string, BusEtaPrediction>;
  showStudentsOnMap: boolean;
  studentsWithLocation: Student[];
  builderStops: RouteStop[];
  builderPolyline: [number, number][];
  placementPreview: { lat: number; lng: number } | null;
}

function renderReactIcon(
  component: ReactNode,
  className: string,
  size: [number, number],
  anchor: [number, number],
) {
  const baseClass = className.split(" ")[0]; // Extract base class for inner div
  return L.divIcon({
    className,
    html: renderToString(
      <div className={`${baseClass}-inner flex items-center justify-center`}>
        {component}
      </div>,
    ),
    iconSize: size,
    iconAnchor: anchor,
    popupAnchor: [0, -anchor[1]],
  });
}

function getBusIcon(isMoving: boolean) {
  return renderReactIcon(
    <PiBusBold
      size={28}
      color="white"
      style={{ filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.3))" }}
    />,
    `bus-marker ${isMoving ? "bus-moving" : "bus-idle"} cursor-pointer`,
    [48, 54], // increased height for pointer tail
    [24, 54], // anchor at bottom point
  );
}

export interface InactiveFleetMarker {
  busId: string;
  plateNumber: string;
  lat: number;
  lng: number;
  routeName: string | null;
}

function getOfflineBusIcon() {
  return renderReactIcon(
    <PiBusBold
      size={26}
      color="white"
      style={{ filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.3))" }}
    />,
    "bus-marker bus-offline cursor-pointer",
    [48, 54],
    [24, 54],
  );
}

function createStopIcon(number: number) {
  return L.divIcon({
    className: "stop-marker",
    html: `<div class=\"stop-marker-inner\"><span>${number}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

const studentIcon = renderReactIcon(
  <PiStudentBold size={24} color="white" />,
  "student-marker",
  [42, 42],
  [21, 21],
);

const placementIcon = renderReactIcon(
  <PiMapPinFill size={32} color="white" />,
  "placement-marker",
  [52, 52],
  [26, 52],
);

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:3001";

function FleetTrackingController({
  center,
  followLiveTracking,
}: {
  center: LatLngExpression | null;
  followLiveTracking: boolean;
}) {
  const map = useMap();
  const hasCenteredRef = useRef(false);

  useEffect(() => {
    if (!center) return;

    if (followLiveTracking) {
      // Live tracking mode gently pans to the active bus
      const zoom = map.getZoom() > 14 ? map.getZoom() : 15;
      map.setView(center, zoom, { animate: true, duration: 0.8 });
      hasCenteredRef.current = true;
      return;
    }

    if (hasCenteredRef.current) return;

    // Auto-center once when fleet view opens
    map.setView(center, 15, { animate: true, duration: 0.8 });
    hasCenteredRef.current = true;
  }, [center, followLiveTracking, map]);

  return null;
}

function MapRefocusHandler({ focus }: { focus: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (focus) {
      map.setView(focus, 16, { animate: true, duration: 0.8 });
    }
  }, [focus, map]);

  return null;
}

function MapClickHandler({
  onClick,
  onDrag,
}: {
  onClick: ((lat: number, lng: number, address: string) => void) | null;
  onDrag?: () => void;
}) {
  useMapEvents({
    dragstart: () => {
      onDrag?.();
    },
    click: async (event) => {
      if (!onClick) return;
      const { lat, lng } = event.latlng;

      let address = "";
      try {
        const response = await fetch(
          `${API_BASE_URL}/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
        );
        const data = (await response.json()) as { display_name?: string };
        if (!response.ok) {
          throw new Error("Reverse geocode proxy error");
        }
        address = data.display_name || "";
      } catch {
        address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }

      onClick(lat, lng, address);
    },
  });

  return null;
}

function MapPersistence() {
  const map = useMap();

  useEffect(() => {
    const saved = getSavedMapView();
    if (saved) {
      map.setView([saved.lat, saved.lng], saved.zoom);
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 14, {
            animate: true,
            duration: 0.8,
          });
        },
        () => {
          // noop
        },
        { timeout: 5000 },
      );
    }

    const onMoveEnd = () => {
      const center = map.getCenter();
      localStorage.setItem(
        MAP_STORAGE_KEY,
        JSON.stringify({
          lat: center.lat,
          lng: center.lng,
          zoom: map.getZoom(),
        }),
      );
    };

    map.on("moveend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
    };
  }, [map]);

  return null;
}

export default function DashboardMap({
  defaultCenter,
  defaultZoom,
  activeTab,
  followLiveTracking,
  followCenter,
  mapClickActive,
  mapFocus,
  onMapClick,
  onMapDrag,
  activeBuses,
  inactiveFleetMarkers,
  fleetList,
  etaByBus,
  showStudentsOnMap,
  studentsWithLocation,
  builderStops,
  builderPolyline,
  placementPreview,
}: DashboardMapProps) {
  return (
    <MapContainer
      center={defaultCenter}
      zoom={defaultZoom}
      className={`h-full w-full ${mapClickActive ? "crosshair-cursor" : ""}`}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      <MapPersistence />
      <MapRefocusHandler focus={mapFocus} />
      <MapClickHandler onClick={onMapClick} onDrag={onMapDrag} />

      {activeTab === "fleet" && followCenter && (
        <FleetTrackingController
          center={followCenter}
          followLiveTracking={followLiveTracking}
        />
      )}

      {activeBuses.map((busLoc) => {
        const busDetails = fleetList.find((bus) => bus.id === busLoc.bus_id);
        const title = busDetails ? busDetails.plate_number : "Unknown Bus";
        const eta = etaByBus[busLoc.bus_id];
        const etaMinutes = toNumber(eta?.eta_minutes);
        const confidencePct = toNumber(eta?.confidence_pct);
        const confidence = getConfidenceMeta(confidencePct);

        return (
          <Marker
            key={`bus-${busLoc.bus_id}`}
            position={[busLoc.lat, busLoc.lng]}
            icon={getBusIcon(busLoc.speed_kmh > 0)}
            draggable={false}
            interactive={true}
          >
            <Popup className="bus-popup custom-popup" autoPan={false}>
              <div className="w-48 flex flex-col font-sans">
                <div className="flex items-center gap-2 mb-2.5">
                  <div
                    className={`w-2 h-2 rounded-full ${busLoc.speed_kmh > 0 ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-red-500"}`}
                  ></div>
                  <span className="text-sm font-extrabold text-gray-900 m-0 tracking-tight">
                    {title}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5 text-[11px]">
                  <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                    <span className="text-gray-400 font-medium">Driver</span>
                    <span className="font-bold text-gray-700 truncate max-w-25 text-right">
                      {/* @ts-ignore: joined dynamic property */}
                      {busDetails?.driver?.name || "Unassigned"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                    <span className="text-gray-400 font-medium">Speed</span>
                    <span className="font-bold text-gray-700">
                      {Math.round(busLoc.speed_kmh)} km/h
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                    <span className="text-gray-400 font-medium">ETA</span>
                    <span className="font-bold text-sky-600">
                      {etaMinutes != null
                        ? `${Math.round(etaMinutes)} min`
                        : "--"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                    <span className="text-gray-400 font-medium">
                      Confidence
                    </span>
                    <span
                      className="font-bold"
                      style={{
                        color:
                          confidencePct == null
                            ? "#9ca3af"
                            : confidencePct >= 80
                              ? "#10b981" // emerald-500
                              : confidencePct >= 60
                                ? "#f59e0b" // amber-500
                                : "#ef4444", // red-500
                      }}
                    >
                      {confidencePct != null
                        ? `${confidence.label} (${Math.round(confidencePct)}%)`
                        : confidence.label}
                    </span>
                  </div>

                  <div className="mt-1 pt-2 border-t border-gray-100 flex justify-between items-center text-[9px]">
                    <span className="text-gray-400">Updated</span>
                    <span className="text-gray-500 font-bold tracking-wide">
                      {formatTime(busLoc.recorded_at)}
                    </span>
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {activeTab === "fleet" &&
        inactiveFleetMarkers.map((bus) => (
          <Marker
            key={`offline-${bus.busId}`}
            position={[bus.lat, bus.lng]}
            icon={getOfflineBusIcon()}
            draggable={false}
            interactive={true}
          >
            <Popup className="bus-popup custom-popup" autoPan={false}>
              <div className="w-48 flex flex-col font-sans">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-2 h-2 rounded-full bg-gray-500"></div>
                  <span className="text-sm font-extrabold text-gray-900 m-0 tracking-tight">
                    {bus.plateNumber}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5 text-[11px]">
                  <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                    <span className="text-gray-400 font-medium">Status</span>
                    <span className="font-bold text-gray-700">
                      Registered (offline)
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                    <span className="text-gray-400 font-medium">Route</span>
                    <span className="font-bold text-gray-700 text-right truncate max-w-25">
                      {bus.routeName ?? "No default route"}
                    </span>
                  </div>

                  <div className="mt-1 pt-2 border-t border-gray-100 text-[10px] text-gray-500">
                    Waiting for the first GPS heartbeat.
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

      {showStudentsOnMap &&
        studentsWithLocation.map((student) => (
          <Marker
            key={`student-${student.id}`}
            position={[student.lat as number, student.lng as number]}
            icon={studentIcon}
          >
            <Popup>
              <b>{student.name}</b>
              <br />
              {student.address || "No address"}
              <br />
              {student.route_id ? (
                <span style={{ color: "#4338ca" }}>Assigned</span>
              ) : (
                <span style={{ color: "#dc2626" }}>Unassigned</span>
              )}
            </Popup>
          </Marker>
        ))}

      {activeTab === "routes" &&
        builderStops.map((stop, index) => (
          <Marker
            key={`stop-${index}`}
            position={[stop.lat, stop.lng]}
            icon={createStopIcon(index + 1)}
          >
            <Popup>
              <b>
                Stop {index + 1}: {stop.name}
              </b>
            </Popup>
          </Marker>
        ))}

      {activeTab === "routes" && builderPolyline.length >= 2 && (
        <Polyline
          positions={builderPolyline}
          pathOptions={{
            color: "#3b82f6",
            weight: 4,
            opacity: 0.8,
            dashArray: "10, 6",
          }}
        />
      )}

      {placementPreview && (
        <Marker
          position={[placementPreview.lat, placementPreview.lng]}
          icon={placementIcon}
        />
      )}
    </MapContainer>
  );
}
