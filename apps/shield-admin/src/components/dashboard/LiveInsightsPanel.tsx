import type { Bus, BusEtaPrediction, RouteOption } from "../../supabase";

export interface ApprovedReroute {
  id: string;
  busId: string;
  busLabel: string;
  routeId: string;
  estimatedMinutes: number;
  approvedAt: string;
  note: string;
}

interface ConfidenceMeta {
  label: string;
  badgeClass: string;
}

interface LiveInsightsPanelProps {
  activeBusIds: string[];
  fleetList: Bus[];
  selectedBusId: string;
  selectedEta?: BusEtaPrediction;
  recommendedRoute?: RouteOption;
  approvedReroutes: ApprovedReroute[];
  auditOptions: RouteOption[];
  selectedAuditRouteId: string;
  auditUpdatedAt: string | null;
  auditLoading: boolean;
  auditError: string | null;
  onSelectBus: (busId: string) => void;
  onApproveRecommended: () => void;
  onDismissSuggestion: () => void;
  onRunRouteAudit: () => void;
  onSelectAuditRoute: (routeId: string) => void;
  onApproveAuditSelection: () => void;
  toNumber: (value: unknown) => number | null;
  formatTime: (value: string | null | undefined) => string;
  getConfidenceMeta: (confidencePct: number | null) => ConfidenceMeta;
}

export default function LiveInsightsPanel({
  activeBusIds,
  fleetList,
  selectedBusId,
  selectedEta,
  recommendedRoute,
  approvedReroutes,
  auditOptions,
  selectedAuditRouteId,
  auditUpdatedAt,
  auditLoading,
  auditError,
  onSelectBus,
  onApproveRecommended,
  onDismissSuggestion,
  onRunRouteAudit,
  onSelectAuditRoute,
  onApproveAuditSelection,
  toNumber,
  formatTime,
  getConfidenceMeta,
}: LiveInsightsPanelProps) {
  return (
    <div className="absolute top-4 right-4 w-96 bg-white/80 backdrop-blur-md rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-white/40 z-1000 overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="px-5 py-4 border-b border-gray-100/50 bg-linear-to-br from-indigo-500/10 to-sky-500/10">
        <div className="flex items-center justify-between mb-1">
          <p className="m-0 text-sm font-bold text-gray-900 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live Travel Insights
          </p>
          <div className="px-2 py-0.5 rounded-full bg-white/50 text-[10px] font-bold text-indigo-600 border border-indigo-100 uppercase tracking-wider">
            Real-time
          </div>
        </div>
        <p className="m-0 text-xs text-gray-500 font-medium">
          AI-powered arrival estimates and route optimization
        </p>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {activeBusIds.length === 0 ? (
          <p className="m-0 text-sm text-gray-500">
            No active buses yet. Start a trip to see ETA and route suggestions.
          </p>
        ) : (
          <>
            <label className="text-xs font-semibold text-gray-600">
              Active bus
            </label>
            <select
              value={selectedBusId}
              onChange={(e) => onSelectBus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {activeBusIds.map((busId) => {
                const details = fleetList.find((bus) => bus.id === busId);
                return (
                  <option key={busId} value={busId}>
                    {details?.plate_number ?? `Bus ${busId.slice(0, 8)}`}
                  </option>
                );
              })}
            </select>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-sky-100 bg-linear-to-br from-sky-50 to-white p-3.5 shadow-sm">
                <p className="m-0 text-[10px] uppercase tracking-wider text-sky-600 font-bold">
                  Arrival estimate
                </p>
                <div className="flex items-baseline gap-1 mt-1">
                  <p className="m-0 text-2xl font-black text-sky-900">
                    {toNumber(selectedEta?.eta_minutes) != null
                      ? Math.round(toNumber(selectedEta?.eta_minutes) as number)
                      : "--"}
                  </p>
                  <span className="text-xs font-bold text-sky-700">min</span>
                </div>
                <p className="m-0 mt-2 text-[10px] text-sky-500 font-medium flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-sky-400"></span>
                  Last updated {formatTime(selectedEta?.predicted_at)}
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-linear-to-br from-gray-50 to-white p-3.5 shadow-sm">
                <p className="m-0 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                  Estimate quality
                </p>
                <div className="mt-2 text-center">
                  {(() => {
                    const confidencePct = toNumber(selectedEta?.confidence_pct);
                    const meta = getConfidenceMeta(confidencePct);
                    return (
                      <span
                        className={`inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-xs border ${meta.badgeClass.includes("emerald") ? "border-emerald-200" : meta.badgeClass.includes("amber") ? "border-amber-200" : "border-rose-200"} ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    );
                  })()}
                </div>
                <p className="m-0 mt-2 text-[10px] text-gray-400 font-medium text-center">
                  {toNumber(selectedEta?.confidence_pct) != null
                    ? `${Math.round(toNumber(selectedEta?.confidence_pct) as number)}% confidence`
                    : "Analyzing..."}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-linear-to-br from-indigo-50 to-white p-4 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between gap-2 relative z-10">
                <p className="m-0 text-xs font-bold text-indigo-900 uppercase tracking-wider">
                  AI recommended route
                </p>
              </div>

              {recommendedRoute ? (
                <div className="relative z-10">
                  <div className="mt-3 flex items-center justify-between">
                    <p className="m-0 text-sm font-black text-indigo-950">
                      {recommendedRoute.route_id}
                    </p>
                    <span className="px-2 py-0.5 rounded bg-indigo-600 text-[10px] font-bold text-white uppercase">
                      Fastest
                    </span>
                  </div>
                  <p className="m-0 mt-2 text-xs text-indigo-700 font-medium leading-relaxed">
                    {recommendedRoute.notes ||
                      "Suggested as the quickest option based on current traffic and telemetry."}
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={onApproveRecommended}
                      className="flex-1 px-4 py-2 rounded-xl bg-[#1a237e] text-white text-[11px] font-bold border-none cursor-pointer hover:bg-indigo-900 transition shadow-lg shadow-indigo-200"
                    >
                      Approve reroute
                    </button>
                    <button
                      onClick={onDismissSuggestion}
                      className="px-4 py-2 rounded-xl bg-white text-gray-600 text-[11px] font-bold border border-gray-200 cursor-pointer hover:bg-gray-50 transition"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 py-4 text-center border-2 border-dashed border-indigo-100 rounded-lg">
                  <p className="m-0 text-xs text-indigo-400 font-medium italic">
                    No recommendations available yet.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Audit mode
                </p>
                <button
                  onClick={onRunRouteAudit}
                  disabled={auditLoading || !selectedBusId}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-[11px] font-bold border-none cursor-pointer hover:bg-sky-700 transition disabled:opacity-50"
                >
                  {auditLoading ? "Running..." : "Run route audit"}
                </button>
              </div>

              <p className="m-0 mt-1 text-[11px] text-gray-500">
                Compare the top route options and approve the one you trust
                most.
              </p>

              {auditUpdatedAt ? (
                <p className="m-0 mt-2 text-[10px] text-gray-400">
                  Last audit update: {formatTime(auditUpdatedAt)}
                </p>
              ) : null}

              {auditError ? (
                <p className="m-0 mt-2 text-[11px] text-rose-600">
                  {auditError}
                </p>
              ) : null}

              {auditOptions.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {auditOptions.map((route) => (
                    <label
                      key={route.route_id}
                      className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="audit-route-choice"
                        checked={selectedAuditRouteId === route.route_id}
                        onChange={() => onSelectAuditRoute(route.route_id)}
                        className="mt-0.5"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-gray-800">
                          {route.route_id} ·{" "}
                          {Math.round(route.estimated_minutes)} min
                        </span>
                        <span className="block text-[11px] text-gray-500 mt-0.5">
                          {route.notes || "Alternative route option"}
                        </span>
                      </span>
                    </label>
                  ))}

                  <button
                    onClick={onApproveAuditSelection}
                    disabled={!selectedAuditRouteId}
                    className="mt-1 px-3 py-2 rounded-lg bg-[#1a237e] text-white text-[11px] font-bold border-none cursor-pointer hover:bg-indigo-900 transition disabled:opacity-50"
                  >
                    Approve selected route
                  </button>
                </div>
              ) : (
                <div className="mt-3 py-3 border border-dashed border-gray-200 rounded-lg text-center">
                  <p className="m-0 text-[11px] text-gray-400 italic">
                    No audited options yet. Click "Run route audit".
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="m-0 text-sm font-semibold text-gray-800">
                Approved reroutes
              </p>
              {approvedReroutes.length === 0 ? (
                <p className="m-0 mt-1 text-xs text-gray-500">
                  Approved routes will appear here.
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-2 max-h-44 overflow-y-auto">
                  {approvedReroutes.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2"
                    >
                      <p className="m-0 text-xs font-semibold text-gray-800">
                        {item.busLabel} - {item.routeId}
                      </p>
                      <p className="m-0 text-[11px] text-gray-600 mt-0.5">
                        ETA {Math.round(item.estimatedMinutes)} min · Approved{" "}
                        {formatTime(item.approvedAt)}
                      </p>
                      {item.note ? (
                        <p className="m-0 text-[11px] text-gray-500 mt-0.5">
                          {item.note}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
