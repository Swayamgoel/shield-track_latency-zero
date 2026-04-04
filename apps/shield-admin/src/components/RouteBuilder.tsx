import { useState, useEffect, useCallback, FormEvent, useRef } from "react";
import {
  PiMapTrifoldBold,
  PiPencilBold,
  PiHourglassBold,
  PiPlusBold,
  PiTrashBold,
  PiFloppyDiskBold,
  PiMapPinFill,
  PiStudentBold,
} from "react-icons/pi";
import { supabase } from "../supabase";
import type { Route, RouteStop, Student } from "../supabase";

interface RouteBuilderProps {
  tenantId: string;
  /** Called to enter build mode — parent wires map clicks to the callback */
  onRequestMapClick: (
    callback: (lat: number, lng: number, address: string) => void,
  ) => void;
  onCancelMapClick: () => void;
  /** Expose current builder stops so the map can render them */
  onStopsChange: (stops: RouteStop[]) => void;
  /** Expose OSRM-routed polyline coordinates for map rendering */
  onPolylineChange: (coords: [number, number][]) => void;
}

/** Fetch a road-following polyline from OSRM between ordered stops */
async function fetchOSRMRoute(stops: RouteStop[]): Promise<[number, number][]> {
  if (stops.length < 2) return stops.map((s) => [s.lat, s.lng]);

  // OSRM expects lon,lat (not lat,lng!)
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === "Ok" && data.routes?.[0]) {
      // GeoJSON coordinates are [lng, lat], we need [lat, lng] for Leaflet
      return data.routes[0].geometry.coordinates.map(
        (c: [number, number]) => [c[1], c[0]] as [number, number],
      );
    }
  } catch (err) {
    console.warn("OSRM fetch failed, falling back to straight lines:", err);
  }

  // Fallback: straight lines
  return stops.map((s) => [s.lat, s.lng]);
}

function normalizeRouteStops(rawStops: unknown): RouteStop[] {
  if (!Array.isArray(rawStops)) return [];

  return rawStops
    .map((raw, index) => {
      if (!raw || typeof raw !== "object") return null;

      const candidate = raw as Partial<RouteStop>;
      if (
        typeof candidate.lat !== "number" ||
        typeof candidate.lng !== "number"
      ) {
        return null;
      }

      const normalizedName =
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name
          : `Stop ${index + 1}`;
      const normalizedOrder =
        typeof candidate.order === "number" &&
        Number.isFinite(candidate.order) &&
        candidate.order > 0
          ? candidate.order
          : index + 1;

      return {
        name: normalizedName,
        lat: candidate.lat,
        lng: candidate.lng,
        order: normalizedOrder,
        ...(typeof candidate.arrival_time === "string"
          ? { arrival_time: candidate.arrival_time }
          : {}),
      };
    })
    .filter((stop): stop is RouteStop => stop !== null)
    .sort((a, b) => a.order - b.order)
    .map((stop, index) => ({ ...stop, order: index + 1 }));
}

export default function RouteBuilder({
  tenantId,
  onRequestMapClick,
  onCancelMapClick,
  onStopsChange,
  onPolylineChange,
}: RouteBuilderProps) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [saving, setSaving] = useState(false);
  const [isPlacingStop, setIsPlacingStop] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const osrmRequestSeq = useRef(0);

  // Ref for editing an existing route
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);

  // Students for reference display
  const [students, setStudents] = useState<Student[]>([]);

  const fetchRoutes = useCallback(async () => {
    const { data } = await supabase
      .from("routes")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (data) setRoutes(data);
  }, [tenantId]);

  const fetchStudents = useCallback(async () => {
    const { data } = await supabase
      .from("students")
      .select("*")
      .eq("tenant_id", tenantId);
    if (data) setStudents(data);
  }, [tenantId]);

  useEffect(() => {
    fetchRoutes();
    fetchStudents();
  }, [fetchRoutes, fetchStudents]);

  // Whenever stops change, update parent and refresh polyline with debounced, ordered requests.
  useEffect(() => {
    onStopsChange(stops);

    const requestId = ++osrmRequestSeq.current;

    const timeoutId = window.setTimeout(() => {
      if (stops.length >= 2) {
        void fetchOSRMRoute(stops)
          .then((coords) => {
            if (requestId !== osrmRequestSeq.current) return;
            onPolylineChange(coords);
          })
          .catch(() => {
            if (requestId !== osrmRequestSeq.current) return;
            onPolylineChange(stops.map((s) => [s.lat, s.lng]));
          });
        return;
      }

      if (requestId !== osrmRequestSeq.current) return;
      if (stops.length === 1) {
        onPolylineChange([[stops[0].lat, stops[0].lng]]);
      } else {
        onPolylineChange([]);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [stops, onPolylineChange, onStopsChange]);

  const startBuilding = () => {
    setIsBuilding(true);
    setRouteName("");
    setStops([]);
    setEditingRouteId(null);
    onPolylineChange([]);
    onStopsChange([]);
  };

  const cancelBuilding = () => {
    setIsBuilding(false);
    setIsPlacingStop(false);
    setStops([]);
    setRouteName("");
    setEditingRouteId(null);
    onCancelMapClick();
    onPolylineChange([]);
    onStopsChange([]);
  };

  const handleAddStop = () => {
    setIsPlacingStop(true);
    onRequestMapClick((lat, lng, address) => {
      const newStop: RouteStop = {
        name: address || `Stop ${stops.length + 1}`,
        lat,
        lng,
        order: stops.length + 1,
      };
      setStops((prev) => [...prev, newStop]);
      setIsPlacingStop(false);
    });
  };

  const handleRemoveStop = (index: number) => {
    setStops((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Reorder
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };

  const handleMoveStop = (index: number, direction: "up" | "down") => {
    setStops((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };

  const handleRenameStop = (index: number, newName: string) => {
    setStops((prev) =>
      prev.map((s, i) => (i === index ? { ...s, name: newName } : s)),
    );
  };

  const handleSaveRoute = async (e: FormEvent) => {
    e.preventDefault();
    if (!routeName.trim()) return alert("Please enter a route name.");
    if (stops.length < 2) return alert("A route needs at least 2 stops.");

    setSaving(true);

    // Get the OSRM polyline for storage
    const polylineCoords = await fetchOSRMRoute(stops);
    const polylineJson = polylineCoords.map(
      ([lat, lng]) => [lat, lng] as [number, number],
    );

    const routeData = {
      tenant_id: tenantId,
      name: routeName.trim(),
      polyline: polylineJson,
      stops: stops,
    };

    let error;
    if (editingRouteId) {
      ({ error } = await supabase
        .from("routes")
        .update(routeData)
        .eq("id", editingRouteId));
    } else {
      ({ error } = await supabase.from("routes").insert(routeData));
    }

    if (error) alert("Error saving route: " + error.message);
    else {
      cancelBuilding();
      fetchRoutes();
    }
    setSaving(false);
  };

  const handleEditRoute = (route: Route) => {
    setIsBuilding(true);
    setEditingRouteId(route.id);
    setRouteName(route.name);
    setStops(normalizeRouteStops(route.stops));
  };

  const handleDeleteRoute = async (routeId: string, name: string) => {
    if (
      !confirm(
        `Delete route "${name}"? Students on this route will be unassigned.`,
      )
    )
      return;

    // Unassign students first
    const { error: unassignError } = await supabase
      .from("students")
      .update({ route_id: null })
      .eq("route_id", routeId);

    if (unassignError) {
      alert("Error unassigning students: " + unassignError.message);
      return;
    }

    const { error } = await supabase.from("routes").delete().eq("id", routeId);
    if (error) alert("Error: " + error.message);
    else {
      fetchRoutes();
      fetchStudents();
    }
  };

  const handleViewRoute = (routeId: string) => {
    const newSelectedId = routeId === selectedRouteId ? null : routeId;
    setSelectedRouteId(newSelectedId);

    if (newSelectedId === null) {
      onStopsChange([]);
      onPolylineChange([]);
      return;
    }

    const route = routes.find((r) => r.id === newSelectedId);
    if (!route) {
      onStopsChange([]);
      onPolylineChange([]);
      return;
    }

    const routeStops = Array.isArray(route.stops)
      ? normalizeRouteStops(route.stops)
      : [];
    onStopsChange(routeStops);

    if (!(Array.isArray(route.polyline) && route.polyline.length >= 2)) {
      onPolylineChange([]);
      return;
    }

    const coords = (
      route.polyline as Array<{ lat: number; lng: number } | [number, number]>
    ).map((p): [number, number] => {
      if (Array.isArray(p)) return [p[0], p[1]];
      return [p.lat, p.lng];
    });
    onPolylineChange(coords);
  };

  const unassignedStudents = students.filter(
    (s) => !s.route_id && s.lat != null && s.lng != null,
  );

  // ─── BUILD MODE ───
  if (isBuilding) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-sm font-bold text-[#1a237e] flex items-center gap-1.5">
            {editingRouteId ? (
              <PiPencilBold size={16} />
            ) : (
              <PiMapTrifoldBold size={16} />
            )}
            <span>{editingRouteId ? "Edit Route" : "New Route"}</span>
          </h3>
          <button
            onClick={cancelBuilding}
            className="px-2 py-1 text-xs text-gray-500 hover:text-red-500 bg-transparent border border-gray-200 rounded cursor-pointer transition"
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSaveRoute} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Route name (e.g. North Sector Morning)"
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-800 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          {/* Stops List */}
          <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-blue-700 uppercase">
                Stops ({stops.length})
              </span>
              <button
                type="button"
                onClick={
                  isPlacingStop
                    ? () => {
                        setIsPlacingStop(false);
                        onCancelMapClick();
                      }
                    : handleAddStop
                }
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border-none cursor-pointer transition flex items-center gap-1.5 ${
                  isPlacingStop
                    ? "bg-amber-400 text-amber-900 animate-pulse"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {isPlacingStop ? (
                  <>
                    <PiHourglassBold className="animate-spin" /> Click on map...
                  </>
                ) : (
                  <>
                    <PiPlusBold /> Add Stop
                  </>
                )}
              </button>
            </div>

            {stops.length === 0 ? (
              <p className="text-xs text-gray-400 italic m-0">
                Click "Add Stop" then click on the map to place stops.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {stops.map((stop, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 bg-white rounded-lg px-2.5 py-1.5 border border-blue-100"
                  >
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={stop.name}
                      onChange={(e) => handleRenameStop(i, e.target.value)}
                      className="flex-1 px-1 py-0.5 text-xs border-none bg-transparent text-gray-700 focus:outline-none min-w-0"
                      title={`${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`}
                    />
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMoveStop(i, "up")}
                        disabled={i === 0}
                        className="p-0.5 text-xs bg-transparent border-none cursor-pointer disabled:opacity-20 text-gray-500 hover:text-blue-600"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveStop(i, "down")}
                        disabled={i === stops.length - 1}
                        className="p-0.5 text-xs bg-transparent border-none cursor-pointer disabled:opacity-20 text-gray-500 hover:text-blue-600"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveStop(i)}
                        className="p-0.5 text-xs bg-transparent border-none cursor-pointer text-gray-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unassigned Students Info */}
          {unassignedStudents.length > 0 && (
            <p className="m-0 text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">
              💡 {unassignedStudents.length} unassigned student
              {unassignedStudents.length !== 1 ? "s" : ""} shown as blue pins on
              the map for reference.
            </p>
          )}

          <button
            type="submit"
            disabled={saving || stops.length < 2}
            className="px-4 py-2.5 bg-green-600 text-white font-bold border-none rounded-lg cursor-pointer hover:bg-green-700 transition text-sm disabled:opacity-40 mt-1 flex items-center justify-center gap-2"
          >
            {saving ? (
              "Saving..."
            ) : (
              <>
                <PiFloppyDiskBold size={16} />
                {editingRouteId ? "Update Route" : "Save Route"}
              </>
            )}
          </button>
        </form>
      </div>
    );
  }

  // ─── LIST MODE ───
  return (
    <div className="flex flex-col gap-4 p-4">
      <button
        onClick={startBuilding}
        className="w-full px-4 py-3 bg-linear-to-r from-blue-600 to-indigo-600 text-white font-bold border-none rounded-xl cursor-pointer hover:from-blue-700 hover:to-indigo-700 transition text-sm shadow-md flex items-center justify-center gap-2"
      >
        <PiPlusBold size={18} /> Create New Route
      </button>

      <div className="flex-1 overflow-y-auto">
        <h3 className="m-0 mb-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
          Routes ({routes.length})
        </h3>
        {routes.length === 0 ? (
          <p className="text-sm text-gray-400 italic">
            No routes defined yet. Create one above!
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {routes.map((route) => {
              const routeStops = Array.isArray(route.stops)
                ? normalizeRouteStops(route.stops)
                : [];
              const assignedCount = students.filter(
                (s) => s.route_id === route.id,
              ).length;
              const isSelected = selectedRouteId === route.id;

              return (
                <div
                  key={route.id}
                  className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition cursor-pointer ${
                    isSelected
                      ? "border-blue-400 ring-2 ring-blue-100"
                      : "border-gray-100"
                  }`}
                  onClick={() => handleViewRoute(route.id)}
                >
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="m-0 font-bold text-gray-800 text-sm">
                        {route.name}
                      </p>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditRoute(route);
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-500 bg-transparent border-none cursor-pointer text-xs"
                          title="Edit route"
                        >
                          <PiPencilBold />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRoute(route.id, route.name);
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-500 bg-transparent border-none cursor-pointer text-xs"
                          title="Delete route"
                        >
                          <PiTrashBold />
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-3 text-[10px] text-gray-400 font-semibold uppercase">
                      <span className="flex items-center gap-1">
                        <PiMapPinFill size={12} className="text-blue-500" />{" "}
                        {routeStops.length} stops
                      </span>
                      <span className="flex items-center gap-1">
                        <PiStudentBold size={12} className="text-violet-500" />{" "}
                        {assignedCount} students
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
