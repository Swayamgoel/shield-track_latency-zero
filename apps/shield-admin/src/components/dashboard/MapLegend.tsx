import { PiBusBold, PiStudentBold } from "react-icons/pi";

interface MapLegendProps {
  showStudentsOnMap: boolean;
  showRoutePath: boolean;
}

export default function MapLegend({
  showStudentsOnMap,
  showRoutePath,
}: MapLegendProps) {
  if (!showStudentsOnMap) return null;

  return (
    <div className="absolute bottom-6 right-4 bg-white/95 backdrop-blur-sm rounded-xl p-3 shadow-lg z-1000 border border-gray-200">
      <p className="m-0 mb-1.5 text-xs font-bold text-gray-700">Legend</p>
      <div className="flex flex-col gap-2.5 text-xs text-gray-600">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg bg-linear-to-br from-indigo-500 to-indigo-800 flex items-center justify-center text-white text-[10px] font-black border border-white shadow-sm">
            1
          </div>
          <span className="font-semibold">Route Stops</span>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white border border-white shadow-sm"
            style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}
          >
            <PiStudentBold size={14} />
          </div>
          <span className="font-semibold">Students</span>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-white border border-white shadow-sm"
            style={{ background: "linear-gradient(135deg, #22c55e, #15803d)" }}
          >
            <PiBusBold size={14} />
          </div>
          <span className="font-semibold text-emerald-800 uppercase text-[10px] tracking-tighter">
            Moving bus
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-white border border-white shadow-sm"
            style={{ background: "linear-gradient(135deg, #ef4444, #b91c1c)" }}
          >
            <PiBusBold size={14} />
          </div>
          <span className="font-semibold text-rose-800 uppercase text-[10px] tracking-tighter">
            Idle bus
          </span>
        </div>

        {showRoutePath && (
          <div className="flex items-center gap-3">
            <span className="w-6 h-0.5 bg-indigo-500 border-dashed border-t-2 border-t-indigo-500" />
            <span className="font-semibold">Route path</span>
          </div>
        )}
      </div>
    </div>
  );
}
