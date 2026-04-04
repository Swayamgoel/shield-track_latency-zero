import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  Layer,
  Marker,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
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
  defaultCenter: [number, number];
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

export interface InactiveFleetMarker {
  busId: string;
  plateNumber: string;
  lat: number;
  lng: number;
  routeName: string | null;
}

type PopupState =
  | { kind: "bus"; id: string }
  | { kind: "offline"; id: string }
  | { kind: "student"; id: string }
  | { kind: "stop"; index: number }
  | null;

type RouteLineData = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, never>;
    geometry: {
      type: "LineString";
      coordinates: [number, number][];
    };
  }>;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:3001";
const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY?.trim();
const MAP_STYLE_URL = MAPTILER_API_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`
  : "https://api.maptiler.com/maps/streets-v2/style.json?key=get_your_own_D6rA4zTHduk6KOKTXzGB";

const routeLineLayer = {
  id: "builder-route-line-layer",
  type: "line" as const,
  paint: {
    "line-color": "#3b82f6",
    "line-width": 4,
    "line-opacity": 0.8,
    "line-dasharray": [2, 2],
  },
};

function confidenceTextColor(confidencePct: number | null): string {
  if (confidencePct == null) return "#9ca3af";
  if (confidencePct >= 80) return "#10b981";
  if (confidencePct >= 60) return "#f59e0b";
  return "#ef4444";
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
  const mapRef = useRef<MapRef | null>(null);
  const hasCenteredFleetRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [popupState, setPopupState] = useState<PopupState>(null);

  const initialViewState = useMemo(
    () => ({
      latitude: defaultCenter[0],
      longitude: defaultCenter[1],
      zoom: defaultZoom,
    }),
    [defaultCenter, defaultZoom],
  );

  const routeLineData = useMemo<RouteLineData>(() => {
    if (builderPolyline.length < 2) {
      return {
        type: "FeatureCollection",
        features: [],
      };
    }

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: builderPolyline.map(([lat, lng]) => [lng, lat]),
          },
        },
      ],
    };
  }, [builderPolyline]);

  useEffect(() => {
    if (!mapLoaded) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const saved = getSavedMapView();
    if (saved) {
      map.jumpTo({ center: [saved.lng, saved.lat], zoom: saved.zoom });
      return;
    }

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.easeTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 14,
          duration: 800,
        });
      },
      () => {
        // noop
      },
      { timeout: 5000 },
    );
  }, [mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapFocus) return;

    mapRef.current?.flyTo({
      center: [mapFocus[1], mapFocus[0]],
      zoom: 16,
      duration: 800,
    });
  }, [mapLoaded, mapFocus]);

  useEffect(() => {
    if (activeTab !== "fleet") {
      hasCenteredFleetRef.current = false;
      return;
    }

    if (!mapLoaded || !followCenter) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const center: [number, number] = [followCenter[1], followCenter[0]];

    if (followLiveTracking) {
      const zoom = map.getZoom() > 14 ? map.getZoom() : 15;
      map.easeTo({ center, zoom, duration: 800 });
      hasCenteredFleetRef.current = true;
      return;
    }

    if (hasCenteredFleetRef.current) return;

    map.easeTo({ center, zoom: 15, duration: 800 });
    hasCenteredFleetRef.current = true;
  }, [activeTab, followCenter, followLiveTracking, mapLoaded]);

  const persistMapView = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const center = map.getCenter();
    localStorage.setItem(
      MAP_STORAGE_KEY,
      JSON.stringify({
        lat: center.lat,
        lng: center.lng,
        zoom: map.getZoom(),
      }),
    );
  }, []);

  const handleMapClick = useCallback(
    async (event: MapLayerMouseEvent) => {
      setPopupState(null);

      if (!onMapClick) return;

      const { lat, lng } = event.lngLat;

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

      onMapClick(lat, lng, address);
    },
    [onMapClick],
  );

  return (
    <div className="h-full w-full">
      <Map
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={MAP_STYLE_URL}
        onLoad={() => setMapLoaded(true)}
        onMoveEnd={persistMapView}
        onClick={handleMapClick}
        onDragStart={onMapDrag}
        cursor={mapClickActive ? "crosshair" : "grab"}
        style={{ width: "100%", height: "100%" }}
        reuseMaps
      >
        {activeBuses.map((busLoc) => {
          const busDetails = fleetList.find((bus) => bus.id === busLoc.bus_id);
          const title = busDetails ? busDetails.plate_number : "Unknown Bus";
          const eta = etaByBus[busLoc.bus_id];
          const etaMinutes = toNumber(eta?.eta_minutes);
          const confidencePct = toNumber(eta?.confidence_pct);
          const confidence = getConfidenceMeta(confidencePct);

          return (
            <div key={`bus-wrapper-${busLoc.bus_id}`}>
              <Marker
                longitude={busLoc.lng}
                latitude={busLoc.lat}
                anchor="bottom"
              >
                <button
                  type="button"
                  className={`bus-marker ${busLoc.speed_kmh > 0 ? "bus-moving" : "bus-idle"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPopupState({ kind: "bus", id: busLoc.bus_id });
                  }}
                >
                  <div className="bus-marker-inner flex items-center justify-center">
                    <PiBusBold
                      size={28}
                      color="white"
                      style={{
                        filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.3))",
                      }}
                    />
                  </div>
                </button>
              </Marker>

              {popupState?.kind === "bus" &&
                popupState.id === busLoc.bus_id && (
                  <Popup
                    longitude={busLoc.lng}
                    latitude={busLoc.lat}
                    anchor="top"
                    offset={40}
                    closeOnClick={false}
                    onClose={() => setPopupState(null)}
                    className="bus-popup custom-popup"
                  >
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
                          <span className="text-gray-400 font-medium">
                            Driver
                          </span>
                          <span className="font-bold text-gray-700 truncate max-w-25 text-right">
                            {/* @ts-ignore: joined dynamic property */}
                            {busDetails?.driver?.name || "Unassigned"}
                          </span>
                        </div>

                        <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                          <span className="text-gray-400 font-medium">
                            Speed
                          </span>
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
                              color: confidenceTextColor(confidencePct),
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
                )}
            </div>
          );
        })}

        {activeTab === "fleet" &&
          inactiveFleetMarkers.map((bus) => (
            <div key={`offline-wrapper-${bus.busId}`}>
              <Marker longitude={bus.lng} latitude={bus.lat} anchor="bottom">
                <button
                  type="button"
                  className="bus-marker bus-offline"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPopupState({ kind: "offline", id: bus.busId });
                  }}
                >
                  <div className="bus-marker-inner flex items-center justify-center">
                    <PiBusBold
                      size={26}
                      color="white"
                      style={{
                        filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.3))",
                      }}
                    />
                  </div>
                </button>
              </Marker>

              {popupState?.kind === "offline" &&
                popupState.id === bus.busId && (
                  <Popup
                    longitude={bus.lng}
                    latitude={bus.lat}
                    anchor="top"
                    offset={40}
                    closeOnClick={false}
                    onClose={() => setPopupState(null)}
                    className="bus-popup custom-popup"
                  >
                    <div className="w-48 flex flex-col font-sans">
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className="w-2 h-2 rounded-full bg-gray-500"></div>
                        <span className="text-sm font-extrabold text-gray-900 m-0 tracking-tight">
                          {bus.plateNumber}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5 text-[11px]">
                        <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                          <span className="text-gray-400 font-medium">
                            Status
                          </span>
                          <span className="font-bold text-gray-700">
                            Registered (offline)
                          </span>
                        </div>

                        <div className="flex justify-between items-center bg-gray-50/50 px-1 py-0.5 rounded">
                          <span className="text-gray-400 font-medium">
                            Route
                          </span>
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
                )}
            </div>
          ))}

        {showStudentsOnMap &&
          studentsWithLocation.map((student) => {
            const lat = student.lat as number;
            const lng = student.lng as number;

            return (
              <div key={`student-wrapper-${student.id}`}>
                <Marker longitude={lng} latitude={lat} anchor="center">
                  <button
                    type="button"
                    className="student-marker"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPopupState({ kind: "student", id: student.id });
                    }}
                  >
                    <div className="student-marker-inner flex items-center justify-center">
                      <PiStudentBold size={24} color="white" />
                    </div>
                  </button>
                </Marker>

                {popupState?.kind === "student" &&
                  popupState.id === student.id && (
                    <Popup
                      longitude={lng}
                      latitude={lat}
                      anchor="top"
                      closeOnClick={false}
                      onClose={() => setPopupState(null)}
                    >
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
                  )}
              </div>
            );
          })}

        {activeTab === "routes" &&
          builderStops.map((stop, index) => (
            <div key={`stop-wrapper-${index}`}>
              <Marker longitude={stop.lng} latitude={stop.lat} anchor="center">
                <button
                  type="button"
                  className="stop-marker"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPopupState({ kind: "stop", index });
                  }}
                >
                  <div className="stop-marker-inner">
                    <span>{index + 1}</span>
                  </div>
                </button>
              </Marker>

              {popupState?.kind === "stop" && popupState.index === index && (
                <Popup
                  longitude={stop.lng}
                  latitude={stop.lat}
                  anchor="top"
                  closeOnClick={false}
                  onClose={() => setPopupState(null)}
                >
                  <b>
                    Stop {index + 1}: {stop.name}
                  </b>
                </Popup>
              )}
            </div>
          ))}

        {activeTab === "routes" && builderPolyline.length >= 2 && (
          <Source id="builder-route-line" type="geojson" data={routeLineData}>
            <Layer {...routeLineLayer} />
          </Source>
        )}

        {placementPreview && (
          <Marker
            longitude={placementPreview.lng}
            latitude={placementPreview.lat}
            anchor="bottom"
          >
            <div className="placement-marker">
              <div className="placement-marker-inner flex items-center justify-center">
                <PiMapPinFill size={32} color="white" />
              </div>
            </div>
          </Marker>
        )}
      </Map>
    </div>
  );
}
