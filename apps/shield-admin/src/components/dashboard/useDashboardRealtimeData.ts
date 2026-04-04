import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../../supabase";
import type {
  Bus,
  BusEtaPrediction,
  BusLocation,
  BusRouteRecommendation,
  Route,
  Student,
  Trip,
} from "../../supabase";
import { isNewerRecord } from "./dashboard-utils";

interface UseDashboardRealtimeDataArgs {
  tenantId: string;
}

function isTerminalTripStatus(status: unknown): boolean {
  if (typeof status !== "string") return false;
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "completed" ||
    normalized === "ended" ||
    normalized === "finished"
  );
}

export default function useDashboardRealtimeData({
  tenantId,
}: UseDashboardRealtimeDataArgs) {
  const tenantIdRef = useRef(tenantId);
  tenantIdRef.current = tenantId;

  const latestInsightsRequestSeqRef = useRef(0);

  const [buses, setBuses] = useState<Record<string, BusLocation>>({});
  const [fleetList, setFleetList] = useState<Bus[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [routesCatalog, setRoutesCatalog] = useState<Route[]>([]);
  const [etaByBus, setEtaByBus] = useState<Record<string, BusEtaPrediction>>(
    {},
  );
  const [routeSuggestionsByBus, setRouteSuggestionsByBus] = useState<
    Record<string, BusRouteRecommendation>
  >({});

  useEffect(() => {
    // Clear previous tenant snapshots immediately to avoid cross-tenant stale UI.
    setBuses({});
    setFleetList([]);
    setAllStudents([]);
    setRoutesCatalog([]);
    setEtaByBus({});
    setRouteSuggestionsByBus({});

    // Invalidate any in-flight latest insights request from previous tenant.
    latestInsightsRequestSeqRef.current += 1;
  }, [tenantId]);

  const fetchFleet = useCallback(async () => {
    const requestTenantId = tenantId;
    const { data } = await supabase
      .from("buses")
      .select("*, driver:users (*)")
      .eq("tenant_id", tenantId);

    if (tenantIdRef.current !== requestTenantId) return;
    if (data) setFleetList(data as any);
  }, [tenantId]);

  const fetchStudents = useCallback(async () => {
    const requestTenantId = tenantId;
    const { data } = await supabase
      .from("students")
      .select("*")
      .eq("tenant_id", tenantId);

    if (tenantIdRef.current !== requestTenantId) return;
    if (data) setAllStudents(data);
  }, [tenantId]);

  const fetchRoutes = useCallback(async () => {
    const requestTenantId = tenantId;
    const { data } = await supabase
      .from("routes")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (tenantIdRef.current !== requestTenantId) return;
    if (data) setRoutesCatalog(data);
  }, [tenantId]);

  const fetchLatestInsights = useCallback(async (busIds: string[]) => {
    const requestTenantId = tenantIdRef.current;
    const requestSeq = ++latestInsightsRequestSeqRef.current;

    if (busIds.length === 0) {
      setEtaByBus({});
      setRouteSuggestionsByBus({});
      return;
    }

    const [etaResponses, recResponses] = await Promise.all([
      Promise.all(
        busIds.map((busId) =>
          supabase
            .from("bus_eta_predictions")
            .select("*")
            .eq("bus_id", busId)
            .order("predicted_at", { ascending: false })
            .limit(1),
        ),
      ),
      Promise.all(
        busIds.map((busId) =>
          supabase
            .from("bus_route_recommendations")
            .select("*")
            .eq("bus_id", busId)
            .order("recommended_at", { ascending: false })
            .limit(1),
        ),
      ),
    ]);

    if (
      tenantIdRef.current !== requestTenantId ||
      requestSeq !== latestInsightsRequestSeqRef.current
    ) {
      return;
    }

    if (etaResponses.length > 0) {
      const next: Record<string, BusEtaPrediction> = {};
      etaResponses.forEach((response) => {
        const row = response.data?.[0];
        if (row && !next[row.bus_id]) {
          next[row.bus_id] = row;
        }
      });
      setEtaByBus(next);
    }

    if (recResponses.length > 0) {
      const next: Record<string, BusRouteRecommendation> = {};
      recResponses.forEach((response) => {
        const row = response.data?.[0];
        if (row && !next[row.bus_id]) {
          next[row.bus_id] = row;
        }
      });
      setRouteSuggestionsByBus(next);
    }
  }, []);

  useEffect(() => {
    fetchFleet();
    fetchStudents();
    fetchRoutes();

    const loadInitialData = async () => {
      const requestTenantId = tenantId;
      const { data } = await supabase
        .from("latest_bus_locations")
        .select("*")
        .eq("tenant_id", tenantId);

      if (tenantIdRef.current !== requestTenantId) return;

      if (data) {
        const initialMap: Record<string, BusLocation> = {};
        data.forEach((item: BusLocation) => {
          initialMap[item.bus_id] = item;
        });
        setBuses(initialMap);
      }
    };

    loadInitialData();

    const subscription = supabase
      .channel(`fleet-updates-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bus_locations",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id: string }).id;
            setBuses((prev) => {
              const busIdKey = Object.keys(prev).find(
                (key) => prev[key].id === oldId,
              );
              if (!busIdKey) return prev;
              const next = { ...prev };
              delete next[busIdKey];
              return next;
            });
          } else {
            const incoming = payload.new as BusLocation;
            if (incoming.bus_id) {
              setBuses((prev) => ({ ...prev, [incoming.bus_id]: incoming }));
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trips",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          if (
            payload.eventType !== "INSERT" &&
            payload.eventType !== "UPDATE"
          ) {
            return;
          }

          const incomingTrip = payload.new as Trip;
          if (
            !incomingTrip?.bus_id ||
            !isTerminalTripStatus(incomingTrip.status)
          ) {
            return;
          }

          const busId = incomingTrip.bus_id;

          setBuses((prev) => {
            if (!prev[busId]) return prev;
            const next = { ...prev };
            delete next[busId];
            return next;
          });

          setEtaByBus((prev) => {
            if (!prev[busId]) return prev;
            const next = { ...prev };
            delete next[busId];
            return next;
          });

          setRouteSuggestionsByBus((prev) => {
            if (!prev[busId]) return prev;
            const next = { ...prev };
            delete next[busId];
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "buses",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deletedBusId = (payload.old as { id?: string }).id;
            if (deletedBusId) {
              setBuses((prev) => {
                if (!prev[deletedBusId]) return prev;
                const next = { ...prev };
                delete next[deletedBusId];
                return next;
              });

              setEtaByBus((prev) => {
                if (!prev[deletedBusId]) return prev;
                const next = { ...prev };
                delete next[deletedBusId];
                return next;
              });

              setRouteSuggestionsByBus((prev) => {
                if (!prev[deletedBusId]) return prev;
                const next = { ...prev };
                delete next[deletedBusId];
                return next;
              });
            }
          }

          void fetchFleet();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "students",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void fetchStudents();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "routes",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void fetchRoutes();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bus_eta_predictions" },
        (payload) => {
          const incoming = payload.new as BusEtaPrediction;
          if (!incoming?.bus_id) return;
          setEtaByBus((prev) => {
            const current = prev[incoming.bus_id];
            if (
              current &&
              !isNewerRecord(current.predicted_at, incoming.predicted_at)
            ) {
              return prev;
            }
            return { ...prev, [incoming.bus_id]: incoming };
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bus_route_recommendations",
        },
        (payload) => {
          const incoming = payload.new as BusRouteRecommendation;
          if (!incoming?.bus_id) return;
          setRouteSuggestionsByBus((prev) => {
            const current = prev[incoming.bus_id];
            if (
              current &&
              !isNewerRecord(current.recommended_at, incoming.recommended_at)
            ) {
              return prev;
            }
            return { ...prev, [incoming.bus_id]: incoming };
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [fetchFleet, fetchStudents, fetchRoutes, tenantId]);

  return {
    buses,
    fleetList,
    allStudents,
    routesCatalog,
    etaByBus,
    routeSuggestionsByBus,
    setRouteSuggestionsByBus,
    fetchFleet,
    fetchStudents,
    fetchRoutes,
    fetchLatestInsights,
  };
}
