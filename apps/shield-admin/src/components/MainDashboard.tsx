import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { PiCaretRightBold } from "react-icons/pi";

import { supabase } from "../supabase";
import type { RouteOption, RouteStop } from "../supabase";

import DashboardMap from "./dashboard/DashboardMap";
import DashboardSidebar, {
  type DashboardTabId,
} from "./dashboard/DashboardSidebar";
import LiveInsightsPanel, {
  type ApprovedReroute,
} from "./dashboard/LiveInsightsPanel";
import MapLegend from "./dashboard/MapLegend";
import {
  APPROVED_REROUTES_STORAGE_KEY,
  extractRouteDestination,
  formatTime,
  getConfidenceMeta,
  getSavedMapView,
  loadApprovedReroutes,
  toNumber,
} from "./dashboard/dashboard-utils";
import useDashboardRealtimeData from "./dashboard/useDashboardRealtimeData";

const ML_API_BASE_URL =
  import.meta.env.VITE_ML_API_BASE_URL?.trim() || "http://localhost:8000";

interface MainDashboardProps {
  tenantId: string;
  instituteCode: string;
}

export default function MainDashboard({
  tenantId,
  instituteCode,
}: MainDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTabId>("routes");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mapFocus, setMapFocus] = useState<[number, number] | null>(null);
  const [followLiveTracking, setFollowLiveTracking] = useState(false);

  const [selectedInsightBusId, setSelectedInsightBusId] = useState("");
  const [approvedReroutes, setApprovedReroutes] = useState<ApprovedReroute[]>(
    [],
  );
  const [approvedReroutesTenantReady, setApprovedReroutesTenantReady] =
    useState<string | null>(null);

  const [auditOptions, setAuditOptions] = useState<RouteOption[]>([]);
  const [selectedAuditRouteId, setSelectedAuditRouteId] = useState("");
  const [auditUpdatedAt, setAuditUpdatedAt] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [builderStops, setBuilderStops] = useState<RouteStop[]>([]);
  const [builderPolyline, setBuilderPolyline] = useState<[number, number][]>(
    [],
  );
  const [placementPreview, setPlacementPreview] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [mapClickHandler, setMapClickHandler] = useState<
    ((lat: number, lng: number, address: string) => void) | null
  >(null);

  const {
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
  } = useDashboardRealtimeData({ tenantId });

  const mapClickActive = mapClickHandler !== null;
  const approvedReroutesStorageKey = `${APPROVED_REROUTES_STORAGE_KEY}:${tenantId}`;

  useEffect(() => {
    setApprovedReroutes(loadApprovedReroutes(approvedReroutesStorageKey));
    setApprovedReroutesTenantReady(tenantId);
  }, [approvedReroutesStorageKey, tenantId]);

  useEffect(() => {
    if (approvedReroutesTenantReady !== tenantId) return;

    localStorage.setItem(
      approvedReroutesStorageKey,
      JSON.stringify(approvedReroutes.slice(0, 30)),
    );
  }, [
    approvedReroutes,
    approvedReroutesStorageKey,
    approvedReroutesTenantReady,
    tenantId,
  ]);

  useEffect(() => {
    if (activeTab === "students" || activeTab === "routes") {
      fetchStudents();
    }
    if (activeTab === "fleet") {
      fetchFleet();
      fetchRoutes();
    }
  }, [activeTab, fetchFleet, fetchRoutes, fetchStudents]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleRequestMapClick = useCallback(
    (callback: (lat: number, lng: number, address: string) => void) => {
      setPlacementPreview(null);
      setMapClickHandler(() => (lat: number, lng: number, address: string) => {
        setPlacementPreview({ lat, lng });
        callback(lat, lng, address);
        setMapClickHandler(null);
      });
    },
    [],
  );

  const handleCancelMapClick = useCallback(() => {
    setMapClickHandler(null);
    setPlacementPreview(null);
  }, []);

  const activeBuses = Object.values(buses);
  const activeBusIds = Object.keys(buses);
  const activeBusIdsKey = activeBusIds.join("|");

  useEffect(() => {
    fetchLatestInsights(activeBusIds);
  }, [activeBusIdsKey, fetchLatestInsights]);

  useEffect(() => {
    if (activeBusIds.length === 0) {
      setSelectedInsightBusId("");
      return;
    }
    if (!selectedInsightBusId || !activeBusIds.includes(selectedInsightBusId)) {
      setSelectedInsightBusId(activeBusIds[0]);
    }
  }, [activeBusIdsKey, selectedInsightBusId]);

  const selectedBusId = selectedInsightBusId;
  const selectedBusIdRef = useRef("");
  const auditRequestSeqRef = useRef(0);

  useEffect(() => {
    selectedBusIdRef.current = selectedBusId;
  }, [selectedBusId]);

  const selectedBusDetails = fleetList.find((bus) => bus.id === selectedBusId);
  const selectedBusLocation = selectedBusId ? buses[selectedBusId] : undefined;
  const selectedEta = selectedBusId ? etaByBus[selectedBusId] : undefined;
  const selectedRecommendation = selectedBusId
    ? routeSuggestionsByBus[selectedBusId]
    : undefined;

  const selectedRouteOptions = useMemo(() => {
    return Array.isArray(selectedRecommendation?.routes_json)
      ? (selectedRecommendation.routes_json as RouteOption[])
      : [];
  }, [selectedRecommendation?.routes_json]);

  const recommendedRoute =
    selectedRouteOptions.find((option) => option.is_recommended) ??
    selectedRouteOptions[0];

  useEffect(() => {
    if (selectedRouteOptions.length === 0) {
      setAuditOptions([]);
      setSelectedAuditRouteId("");
      setAuditUpdatedAt(null);
      return;
    }

    setAuditOptions(selectedRouteOptions.slice(0, 3));
    setSelectedAuditRouteId(
      selectedRouteOptions.find((option) => option.is_recommended)?.route_id ||
        selectedRouteOptions[0].route_id,
    );
    setAuditUpdatedAt(selectedRecommendation?.recommended_at ?? null);
  }, [selectedRecommendation?.recommended_at, selectedRouteOptions]);

  const persistApprovedRouteChoice = useCallback(
    async (busId: string, selectedRouteId: string, routes: RouteOption[]) => {
      const normalizedRoutes = routes.map((route) => ({
        ...route,
        is_recommended: route.route_id === selectedRouteId,
        notes:
          route.route_id === selectedRouteId
            ? `${route.notes || ""} Approved by admin`.trim()
            : route.notes,
      }));

      const { data, error } = await supabase
        .from("bus_route_recommendations")
        .insert({ bus_id: busId, routes_json: normalizedRoutes })
        .select("*")
        .single();

      if (error) throw error;

      setRouteSuggestionsByBus((prev) => ({
        ...prev,
        [busId]: data,
      }));
      setAuditOptions(normalizedRoutes);
      setAuditUpdatedAt(data.recommended_at);

      const selected = normalizedRoutes.find(
        (route) => route.route_id === selectedRouteId,
      );
      if (!selected) return;

      const busLabel =
        selectedBusDetails?.plate_number ?? `Bus ${busId.slice(0, 8)}`;
      const record: ApprovedReroute = {
        id: `${busId}-${selected.route_id}-${Date.now()}`,
        busId,
        busLabel,
        routeId: selected.route_id,
        estimatedMinutes: selected.estimated_minutes,
        approvedAt: new Date().toISOString(),
        note: selected.notes,
      };

      setApprovedReroutes((prev) => [record, ...prev].slice(0, 30));
    },
    [selectedBusDetails?.plate_number, setRouteSuggestionsByBus],
  );

  const runRouteAudit = async () => {
    if (!selectedBusId) return;

    const requestBusId = selectedBusId;
    const requestSeq = ++auditRequestSeqRef.current;

    const liveBus = buses[requestBusId];
    const bus = fleetList.find((item) => item.id === requestBusId);
    const defaultRoute = routesCatalog.find(
      (route) => route.id === bus?.default_route_id,
    );
    const destination = extractRouteDestination(defaultRoute);

    if (!liveBus) {
      setAuditError(
        "Live bus location is required before running route audit.",
      );
      return;
    }

    if (!destination) {
      setAuditError(
        "Set a default route with stops for this bus before running route audit.",
      );
      return;
    }

    setAuditLoading(true);
    setAuditError(null);

    try {
      const response = await fetch(`${ML_API_BASE_URL}/predict/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bus_id: requestBusId,
          origin_lat: liveBus.lat,
          origin_lng: liveBus.lng,
          dest_lat: destination.lat,
          dest_lng: destination.lng,
          hour_of_day: new Date().getHours(),
          num_stops: destination.numStops,
        }),
      });

      const payload = (await response.json()) as {
        detail?: string;
        routes?: RouteOption[];
        recommended_at?: string;
      };

      if (!response.ok) {
        throw new Error(payload.detail || "Could not fetch route options.");
      }

      const options = Array.isArray(payload.routes)
        ? payload.routes.slice(0, 3)
        : [];
      if (options.length === 0) {
        throw new Error("No route options returned by the optimizer.");
      }

      if (auditRequestSeqRef.current !== requestSeq) {
        return;
      }

      setRouteSuggestionsByBus((prev) => ({
        ...prev,
        [requestBusId]: {
          id: `local-${Date.now()}`,
          bus_id: requestBusId,
          recommended_at: payload.recommended_at ?? new Date().toISOString(),
          routes_json: options,
        },
      }));

      if (selectedBusIdRef.current !== requestBusId) {
        return;
      }

      setAuditOptions(options);
      setSelectedAuditRouteId(
        options.find((option) => option.is_recommended)?.route_id ||
          options[0].route_id,
      );
      setAuditUpdatedAt(payload.recommended_at ?? new Date().toISOString());
    } catch (error) {
      if (auditRequestSeqRef.current !== requestSeq) {
        return;
      }

      if (selectedBusIdRef.current !== requestBusId) {
        return;
      }
      setAuditError(
        error instanceof Error ? error.message : "Unable to run route audit.",
      );
    } finally {
      if (requestSeq === auditRequestSeqRef.current) {
        setAuditLoading(false);
      }
    }
  };

  const handleApproveRecommended = async () => {
    if (
      !selectedBusId ||
      !recommendedRoute ||
      selectedRouteOptions.length === 0
    ) {
      return;
    }

    try {
      await persistApprovedRouteChoice(
        selectedBusId,
        recommendedRoute.route_id,
        selectedRouteOptions,
      );
      setSelectedAuditRouteId(recommendedRoute.route_id);
      setAuditError(null);
    } catch (error) {
      setAuditError(
        error instanceof Error
          ? error.message
          : "Could not save approved route.",
      );
    }
  };

  const approveAuditSelection = async () => {
    if (!selectedBusId || !selectedAuditRouteId || auditOptions.length === 0) {
      return;
    }

    try {
      await persistApprovedRouteChoice(
        selectedBusId,
        selectedAuditRouteId,
        auditOptions,
      );
      setAuditError(null);
    } catch (error) {
      setAuditError(
        error instanceof Error
          ? error.message
          : "Could not save approved route.",
      );
    }
  };

  const dismissSuggestion = () => {
    if (!selectedBusId) return;
    setRouteSuggestionsByBus((prev) => {
      const next = { ...prev };
      delete next[selectedBusId];
      return next;
    });
  };

  useEffect(() => {
    if (activeTab === "fleet" && followLiveTracking && mapFocus) {
      setMapFocus(null);
    }
  }, [activeTab, followLiveTracking, mapFocus]);

  const followCenter: [number, number] | null = selectedBusLocation
    ? [selectedBusLocation.lat, selectedBusLocation.lng]
    : activeBuses.length > 0
      ? [activeBuses[0].lat, activeBuses[0].lng]
      : null;

  const saved = getSavedMapView();
  const defaultCenter: [number, number] = saved
    ? [saved.lat, saved.lng]
    : activeBuses.length > 0
      ? [activeBuses[0].lat, activeBuses[0].lng]
      : [31.326, 75.5762];
  const defaultZoom = saved?.zoom ?? 13;

  const showStudentsOnMap = activeTab === "students" || activeTab === "routes";
  const studentsWithLocation = allStudents.filter(
    (student) => student.lat != null && student.lng != null,
  );

  return (
    <div className="flex h-screen w-screen m-0 bg-[#f5f7fa] overflow-hidden">
      <DashboardSidebar
        tenantId={tenantId}
        instituteCode={instituteCode}
        isSidebarCollapsed={isSidebarCollapsed}
        activeTab={activeTab}
        mapClickActive={mapClickActive}
        fleetCount={fleetList.length}
        trackingCount={activeBuses.length}
        studentCount={allStudents.length}
        onCollapseSidebar={() => setIsSidebarCollapsed(true)}
        onLogout={handleLogout}
        onSetActiveTab={setActiveTab}
        onCancelMapClick={handleCancelMapClick}
        onRequestMapClick={handleRequestMapClick}
        onUpdateStops={setBuilderStops}
        onUpdatePolyline={setBuilderPolyline}
        onFocusLocation={(lat, lng) => setMapFocus([lat, lng])}
      />

      <div className="flex-1 relative overflow-hidden">
        {isSidebarCollapsed && (
          <button
            onClick={() => setIsSidebarCollapsed(false)}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 bg-[#1a237e] text-white rounded-xl shadow-2xl z-1200 flex items-center justify-center cursor-pointer hover:bg-indigo-900 transition-all hover:scale-105 border-none active:scale-95"
            title="Expand dashboard"
          >
            <PiCaretRightBold size={20} />
          </button>
        )}

        <DashboardMap
          defaultCenter={defaultCenter}
          defaultZoom={defaultZoom}
          activeTab={activeTab}
          followLiveTracking={followLiveTracking}
          followCenter={followCenter}
          mapClickActive={mapClickActive}
          mapFocus={mapFocus}
          onMapClick={mapClickHandler}
          onMapDrag={() => setFollowLiveTracking(false)}
          activeBuses={activeBuses}
          fleetList={fleetList}
          etaByBus={etaByBus}
          showStudentsOnMap={showStudentsOnMap}
          studentsWithLocation={studentsWithLocation}
          builderStops={builderStops}
          builderPolyline={builderPolyline}
          placementPreview={placementPreview}
        />

        {activeTab === "fleet" && (
          <button
            type="button"
            onClick={() => setFollowLiveTracking((prev) => !prev)}
            className={`absolute bottom-6 right-6 z-1000 px-4 py-3 rounded-full border-none shadow-xl transition-all cursor-pointer flex items-center gap-2 font-semibold text-sm ${
              followLiveTracking
                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/30"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
            title="Toggle live bus follow mode"
          >
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                followLiveTracking
                  ? "bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                  : "bg-gray-400"
              }`}
            />
            {followLiveTracking ? "Live Tracking" : "Live Track"}
          </button>
        )}

        {activeTab === "fleet" && (
          <LiveInsightsPanel
            activeBusIds={activeBusIds}
            fleetList={fleetList}
            selectedBusId={selectedBusId}
            selectedEta={selectedEta}
            recommendedRoute={recommendedRoute}
            approvedReroutes={approvedReroutes}
            auditOptions={auditOptions}
            selectedAuditRouteId={selectedAuditRouteId}
            auditUpdatedAt={auditUpdatedAt}
            auditLoading={auditLoading}
            auditError={auditError}
            onSelectBus={setSelectedInsightBusId}
            onApproveRecommended={handleApproveRecommended}
            onDismissSuggestion={dismissSuggestion}
            onRunRouteAudit={runRouteAudit}
            onSelectAuditRoute={setSelectedAuditRouteId}
            onApproveAuditSelection={approveAuditSelection}
            toNumber={toNumber}
            formatTime={formatTime}
            getConfidenceMeta={getConfidenceMeta}
          />
        )}

        <MapLegend
          showStudentsOnMap={showStudentsOnMap}
          showRoutePath={builderPolyline.length >= 2}
        />
      </div>
    </div>
  );
}
