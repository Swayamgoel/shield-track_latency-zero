import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { RouteStop } from "../../supabase";
import {
  PiBusBold,
  PiStudentBold,
  PiMapTrifoldBold,
  PiSteeringWheelBold,
  PiHandTapBold,
  PiXBold,
  PiCaretLeftBold,
} from "react-icons/pi";

import FleetPanel from "../FleetPanel";
import DriverPanel from "../DriverPanel";
import StudentPanel from "../StudentPanel";
import RouteBuilder from "../RouteBuilder";

export type DashboardTabId = "routes" | "fleet" | "students" | "drivers";

const TABS: { id: DashboardTabId; label: string; icon: ReactNode }[] = [
  { id: "routes", label: "Routes", icon: <PiMapTrifoldBold /> },
  { id: "fleet", label: "Fleet", icon: <PiBusBold /> },
  { id: "students", label: "Students", icon: <PiStudentBold /> },
  { id: "drivers", label: "Drivers", icon: <PiSteeringWheelBold /> },
];

interface DashboardSidebarProps {
  tenantId: string;
  instituteCode: string;
  isSidebarCollapsed: boolean;
  activeTab: DashboardTabId;
  mapClickActive: boolean;
  fleetCount: number;
  trackingCount: number;
  studentCount: number;
  onCollapseSidebar: () => void;
  onLogout: () => void;
  onSetActiveTab: (tab: DashboardTabId) => void;
  onCancelMapClick: () => void;
  onRequestMapClick: (
    callback: (lat: number, lng: number, address: string) => void,
  ) => void;
  onUpdateStops: (stops: RouteStop[]) => void;
  onUpdatePolyline: (coords: [number, number][]) => void;
  onFocusLocation: (lat: number, lng: number) => void;
}

export default function DashboardSidebar({
  tenantId,
  instituteCode,
  isSidebarCollapsed,
  activeTab,
  mapClickActive,
  fleetCount,
  trackingCount,
  studentCount,
  onCollapseSidebar,
  onLogout,
  onSetActiveTab,
  onCancelMapClick,
  onRequestMapClick,
  onUpdateStops,
  onUpdatePolyline,
  onFocusLocation,
}: DashboardSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = sidebarRef.current;
    if (!root) return;

    if (isSidebarCollapsed) {
      root.setAttribute("inert", "");

      const focusableElements = root.querySelectorAll<HTMLElement>(
        'a[href], area[href], button, input, select, textarea, [tabindex], [contenteditable="true"], summary',
      );

      focusableElements.forEach((element) => {
        if (element === root) return;

        const previousTabIndex = element.getAttribute("tabindex");
        if (previousTabIndex === null) {
          element.setAttribute("data-prev-tabindex", "");
        } else {
          element.setAttribute("data-prev-tabindex", previousTabIndex);
        }

        element.setAttribute("tabindex", "-1");
      });

      return;
    }

    root.removeAttribute("inert");

    const managedElements = root.querySelectorAll<HTMLElement>(
      "[data-prev-tabindex]",
    );

    managedElements.forEach((element) => {
      const previousTabIndex = element.getAttribute("data-prev-tabindex");
      if (previousTabIndex === "") {
        element.removeAttribute("tabindex");
      } else if (previousTabIndex != null) {
        element.setAttribute("tabindex", previousTabIndex);
      }
      element.removeAttribute("data-prev-tabindex");
    });
  }, [isSidebarCollapsed]);

  return (
    <div
      ref={sidebarRef}
      aria-hidden={isSidebarCollapsed ? "true" : undefined}
      tabIndex={-1}
      className={`bg-white text-gray-800 shadow-[4px_0_15px_rgba(0,0,0,0.05)] z-20 flex flex-col transition-all duration-300 relative ${
        isSidebarCollapsed
          ? "w-0 min-w-0 overflow-hidden pointer-events-none"
          : "w-95 min-w-95"
      }`}
    >
      <div className="px-5 py-4 bg-[#1a237e] text-white flex justify-between items-center shrink-0">
        <div>
          <h1 className="m-0 text-xl font-extrabold tracking-tight">
            ShieldTrack
          </h1>
          <p className="m-0 mt-0.5 opacity-80 text-xs">{instituteCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onLogout}
            className="px-2.5 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-white text-xs font-semibold border-none cursor-pointer transition backdrop-blur"
          >
            Logout
          </button>
          <button
            onClick={onCollapseSidebar}
            className="w-8 h-8 bg-white/15 hover:bg-white/25 rounded-lg text-white border-none cursor-pointer transition backdrop-blur flex items-center justify-center"
            title="Collapse sidebar"
          >
            <PiCaretLeftBold size={14} />
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-200 shrink-0 bg-gray-50">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSetActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-xs font-semibold border-none cursor-pointer transition flex flex-col items-center gap-0.5 ${
              activeTab === tab.id
                ? "bg-white text-[#1a237e] border-b-2 border-b-[#1a237e] shadow-sm"
                : "bg-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            <span className="text-lg flex items-center justify-center h-5">
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {mapClickActive && (
        <div className="px-4 py-2.5 bg-amber-400 text-amber-900 text-xs font-bold flex items-center justify-between shrink-0 animate-pulse">
          <span className="flex items-center gap-2">
            <PiHandTapBold size={16} /> Click on the map to place a point
          </span>
          <button
            onClick={onCancelMapClick}
            className="px-2 py-1 bg-amber-600 text-white text-xs rounded-lg flex items-center gap-1 border-none cursor-pointer hover:bg-amber-700 transition"
          >
            <PiXBold /> Cancel
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {activeTab === "routes" && (
          <RouteBuilder
            tenantId={tenantId}
            onRequestMapClick={onRequestMapClick}
            onCancelMapClick={onCancelMapClick}
            onStopsChange={onUpdateStops}
            onPolylineChange={onUpdatePolyline}
          />
        )}

        {activeTab === "fleet" && (
          <FleetPanel tenantId={tenantId} onFocusLocation={onFocusLocation} />
        )}

        {activeTab === "students" && (
          <StudentPanel
            tenantId={tenantId}
            onRequestMapClick={onRequestMapClick}
            onCancelMapClick={onCancelMapClick}
            onFocusLocation={onFocusLocation}
          />
        )}

        {activeTab === "drivers" && <DriverPanel tenantId={tenantId} />}
      </div>

      <div className="px-4 py-2 border-t border-gray-200 text-[10px] uppercase font-bold text-gray-400 flex justify-between shrink-0 bg-gray-50">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <PiBusBold size={14} className="text-blue-600" /> Fleet:{" "}
            {fleetCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" /> Tracking:{" "}
            {trackingCount}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <PiStudentBold size={14} className="text-violet-600" /> {studentCount}{" "}
          students
        </span>
      </div>
    </div>
  );
}
