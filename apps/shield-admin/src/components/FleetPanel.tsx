import { useState, useEffect, useCallback, FormEvent } from "react";
import type { MouseEvent } from "react";
import {
  PiBusBold,
  PiPlusBold,
  PiTrashBold,
  PiMapPinFill,
} from "react-icons/pi";
import { supabase } from "../supabase";
import type { Bus, Route, User } from "../supabase";

interface FleetPanelProps {
  tenantId: string;
  onFocusLocation?: (lat: number, lng: number) => void;
}

const DEFAULT_CAPACITY = 40;
const MIN_CAPACITY = 10;
const MAX_CAPACITY = 100;

export default function FleetPanel({
  tenantId,
  onFocusLocation,
}: FleetPanelProps) {
  const [fleetList, setFleetList] = useState<Bus[]>([]);
  const [driverList, setDriverList] = useState<User[]>([]);
  const [routeList, setRouteList] = useState<Route[]>([]);
  const [newPlateNumber, setNewPlateNumber] = useState("");
  const [newBusCapacity, setNewBusCapacity] = useState("40");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [saving, setSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const fetchFleet = useCallback(async () => {
    const { data } = await supabase
      .from("buses")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (data) setFleetList(data);
  }, [tenantId]);

  const fetchDrivers = useCallback(async () => {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("role", "driver")
      .order("email", { ascending: true });
    if (data) setDriverList(data);
  }, [tenantId]);

  const fetchRoutes = useCallback(async () => {
    const { data } = await supabase
      .from("routes")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });
    if (data) setRouteList(data);
  }, [tenantId]);

  const handleFocusBus = async (busId: string) => {
    if (!onFocusLocation) return;
    const { data, error } = await supabase
      .from("latest_bus_locations")
      .select("lat, lng")
      .eq("bus_id", busId)
      .maybeSingle();

    if (error) {
      console.error("Failed to fetch latest bus location:", error);
      return;
    }

    if (data?.lat == null || data?.lng == null) {
      console.info(`No latest location found for bus ${busId}.`);
      return;
    }

    onFocusLocation(data.lat, data.lng);
  };

  useEffect(() => {
    fetchFleet();
    fetchDrivers();
    fetchRoutes();
  }, [fetchFleet, fetchDrivers, fetchRoutes]);

  const handleRegisterBus = async (e: FormEvent) => {
    e.preventDefault();
    if (!newPlateNumber.trim()) return;

    const plate = newPlateNumber.trim().toUpperCase();

    let capacity = parseInt(newBusCapacity, 10);
    if (isNaN(capacity)) capacity = DEFAULT_CAPACITY;
    capacity = Math.max(MIN_CAPACITY, Math.min(MAX_CAPACITY, capacity));

    setSaving(true);
    const { error } = await supabase.from("buses").insert({
      plate_number: plate,
      tenant_id: tenantId,
      capacity,
      driver_id: selectedDriverId || null,
      default_route_id: selectedRouteId || null,
    });

    if (error) alert("Error: This Plate Number might already exist!");
    else {
      setNewPlateNumber("");
      setNewBusCapacity("40");
      setSelectedDriverId("");
      setSelectedRouteId("");
      setIsCreating(false);
      fetchFleet();
    }
    setSaving(false);
  };

  const handleDeleteBus = async (
    e: MouseEvent,
    busId: string,
    plate: string,
  ) => {
    e.stopPropagation();
    if (!confirm(`Delete bus ${plate}? This cannot be undone.`)) return;
    const { error } = await supabase.from("buses").delete().eq("id", busId);
    if (error) alert("Error deleting bus: " + error.message);
    else fetchFleet();
  };

  const driverNameById = new Map(
    driverList.map((driver) => [
      driver.id,
      driver.email || `Driver ${driver.id.slice(0, 8)}`,
    ]),
  );
  const routeNameById = new Map(
    routeList.map((route) => [route.id, route.name]),
  );

  return (
    <div className="flex flex-col gap-4 p-4 h-full bg-[#fcfdff]">
      {/* Registration Form OR Create Button */}
      {isCreating ? (
        <div className="bg-indigo-50/50 rounded-2xl p-5 border border-indigo-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="m-0 text-sm font-black text-[#1a237e] flex items-center gap-2">
              <div className="p-1.5 bg-indigo-600 rounded-lg text-white">
                <PiBusBold size={16} />
              </div>
              <span>Register New Vehicle</span>
            </h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-xs font-bold text-gray-500 hover:text-gray-800 bg-transparent border-none cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <form onSubmit={handleRegisterBus} className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Plate Number (e.g. PB-01-1234)"
                value={newPlateNumber}
                onChange={(e) => setNewPlateNumber(e.target.value)}
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-indigo-100 text-gray-800 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 min-w-0 transition-all font-medium"
              />
              <input
                type="number"
                placeholder="Seats"
                value={newBusCapacity}
                onChange={(e) => setNewBusCapacity(e.target.value)}
                className="w-20 px-2 py-2.5 rounded-xl border border-indigo-100 text-gray-800 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium"
                min={MIN_CAPACITY}
                max={MAX_CAPACITY}
              />
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <select
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
                className="px-3.5 py-2.5 rounded-xl border border-indigo-100 text-gray-800 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium appearance-none cursor-pointer"
              >
                <option value="">Assign Driver (Optional)</option>
                {driverList.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.email || `Driver ${driver.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>

              <select
                value={selectedRouteId}
                onChange={(e) => setSelectedRouteId(e.target.value)}
                className="px-3.5 py-2.5 rounded-xl border border-indigo-100 text-gray-800 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium appearance-none cursor-pointer"
              >
                <option value="">Default Route (Optional)</option>
                {routeList.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={saving}
                className="mt-2 w-full py-3 bg-[#1a237e] text-white font-bold border-none rounded-xl cursor-pointer hover:bg-indigo-900 transition-all text-sm disabled:opacity-50 shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
              >
                {saving ? "Saving..." : "Save Vehicle"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setIsCreating(true)}
          className="w-full py-3.5 bg-[#1a237e] text-white font-bold border-none rounded-xl cursor-pointer hover:bg-indigo-900 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
        >
          <PiPlusBold size={18} />
          Register New Vehicle
        </button>
      )}

      {/* Fleet List */}
      {!isCreating && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-300">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="m-0 text-[11px] font-black text-gray-400 uppercase tracking-widest">
              Fleet Directory
            </h3>
            <span className="px-2 py-0.5 bg-gray-100 rounded-full text-[10px] font-bold text-gray-500">
              {fleetList.length} Vehicles
            </span>
          </div>

          {fleetList.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-2 opacity-50">
              <PiBusBold size={48} />
              <p className="text-sm font-medium italic">
                No vehicles registered yet.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 pb-4">
              {fleetList.map((bus) => (
                <div
                  key={bus.id}
                  onClick={() => handleFocusBus(bus.id)}
                  className="group flex flex-col bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-indigo-200 transition-all duration-300 cursor-pointer relative overflow-hidden"
                >
                  {/* Decorative background element */}
                  <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <PiBusBold size={80} />
                  </div>

                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 transition-colors group-hover:bg-indigo-600 group-hover:text-white">
                        <PiBusBold size={24} />
                      </div>
                      <div>
                        <p className="m-0 font-black text-gray-900 text-base flex items-center gap-2">
                          {bus.plate_number}
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded uppercase">
                            Active
                          </span>
                        </p>
                        <p className="m-0 text-xs font-bold text-gray-400 mt-0.5">
                          {bus.capacity} Seater Luxury Coach
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) =>
                        handleDeleteBus(e, bus.id, bus.plate_number)
                      }
                      className="p-2 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all border-none cursor-pointer"
                      title="Delete bus"
                    >
                      <PiTrashBold size={18} />
                    </button>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-50 flex flex-col gap-2 relative z-10">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>
                      <p className="m-0 text-[11px] text-gray-500 font-semibold">
                        <span className="text-gray-400 uppercase tracking-tighter mr-1">
                          Driver:
                        </span>
                        <span className="text-gray-700">
                          {bus.driver_id
                            ? driverNameById.get(bus.driver_id)
                            : "Not Assigned"}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400"></div>
                      <p className="m-0 text-[11px] text-gray-500 font-semibold">
                        <span className="text-gray-400 uppercase tracking-tighter mr-1">
                          Route:
                        </span>
                        <span className="text-gray-700">
                          {bus.default_route_id
                            ? routeNameById.get(bus.default_route_id)
                            : "Dynamic Routing"}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between relative z-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFocusBus(bus.id);
                      }}
                      className="flex items-center gap-1.5 text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:text-indigo-800 transition-colors border-none bg-transparent cursor-pointer"
                    >
                      <PiMapPinFill size={14} /> Locate on Map
                    </button>
                    <span className="text-[10px] text-gray-300 font-mono">
                      v1.4.0
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
