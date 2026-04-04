import { useState, useEffect, useCallback, FormEvent } from "react";
import {
  PiSteeringWheelBold,
  PiPlusBold,
  PiTrashBold,
  PiUserCircleBold,
} from "react-icons/pi";
import { supabase } from "../supabase";
import type { User } from "../supabase";

interface DriverPanelProps {
  tenantId: string;
}

export default function DriverPanel({ tenantId }: DriverPanelProps) {
  const [drivers, setDrivers] = useState<User[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const fetchDrivers = useCallback(async () => {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("role", "driver")
      .order("created_at", { ascending: false });
    if (data) setDrivers(data);
  }, [tenantId]);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  const handleAddDriver = async (e: FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("Please enter a valid email address.");
      return;
    }

    setSaving(true);

    // Check if driver with this email already exists for this tenant
    const { data: existing, error: existingError } = await supabase
      .from("users")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();

    if (existingError) {
      console.error("Error checking existing driver:", existingError);
      alert("Error checking existing users. Please try again.");
      setSaving(false);
      return;
    }

    if (existing) {
      alert("A user with this email already exists.");
      setSaving(false);
      return;
    }

    // Insert directly into users table with role = 'driver'
    const { error } = await supabase.from("users").insert({
      tenant_id: tenantId,
      email,
      role: "driver",
    });

    if (error) {
      alert("Error registering driver: " + error.message);
    } else {
      setNewEmail("");
      setIsCreating(false);
      fetchDrivers();
    }
    setSaving(false);
  };

  const handleDeleteDriver = async (driverId: string, email: string | null) => {
    if (!confirm(`Remove driver ${email || "Unknown"}?`)) return;
    const { error } = await supabase.from("users").delete().eq("id", driverId);
    if (error) alert("Error removing driver: " + error.message);
    else fetchDrivers();
  };

  return (
    <div className="flex flex-col gap-4 p-4 h-full bg-[#fcfdff]">
      {/* Registration Form OR Create Toggle */}
      {isCreating ? (
        <div className="bg-emerald-50/50 rounded-2xl p-5 border border-emerald-100 shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="m-0 text-sm font-black text-[#1a237e] flex items-center gap-2">
              <div className="p-1.5 bg-emerald-600 rounded-lg text-white">
                <PiSteeringWheelBold size={16} />
              </div>
              <span>Register Driver</span>
            </h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-xs font-bold text-gray-500 hover:text-gray-800 bg-transparent border-none cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <form onSubmit={handleAddDriver} className="flex gap-2">
            <input
              type="email"
              placeholder="Driver email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-emerald-100 text-gray-800 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 font-medium transition-all min-w-0"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-[#1a237e] text-white font-bold border-none rounded-xl cursor-pointer hover:bg-emerald-800 transition-all text-sm disabled:opacity-40 shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 shrink-0"
            >
              {saving ? (
                "..."
              ) : (
                <>
                  <PiPlusBold size={16} /> Save Driver
                </>
              )}
            </button>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setIsCreating(true)}
          className="w-full py-3.5 bg-[#1a237e] text-white font-bold border-none rounded-xl cursor-pointer hover:bg-indigo-900 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
        >
          <PiPlusBold size={18} />
          Register New Driver
        </button>
      )}

      {/* Driver List */}
      {!isCreating && (
        <div className="flex-1 overflow-y-auto">
          <h3 className="m-0 mb-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
            Drivers ({drivers.length})
          </h3>
          {drivers.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              No drivers registered yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {drivers.map((driver) => (
                <div
                  key={driver.id}
                  className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-100 shadow-sm hover:shadow-md transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                      <PiUserCircleBold size={20} />
                    </div>
                    <div>
                      <p className="m-0 font-bold text-gray-800 text-sm">
                        {driver.email || "No email"}
                      </p>
                      <p className="m-0 text-xs text-gray-400">
                        ID: {driver.id.slice(0, 8)}…
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteDriver(driver.id, driver.email)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition bg-transparent border-none cursor-pointer text-xs"
                    title="Remove driver"
                  >
                    <PiTrashBold />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
