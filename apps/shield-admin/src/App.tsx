import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import LoginScreen from "./components/LoginScreen";
import MainDashboard from "./components/MainDashboard";
import "leaflet/dist/leaflet.css";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [instituteCode, setInstituteCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [accessDeniedMsg, setAccessDeniedMsg] = useState("");

  useEffect(() => {
    const handleSession = async (session: any) => {
      if (!session?.user) {
        setIsAuthenticated(false);
        setTenantId(null);
        setLoading(false);
        return;
      }
      
      const { data, error } = await supabase
        .from("users")
        .select("role, tenant_id, tenants(institute_code)")
        .eq("id", session.user.id)
        .single();
        
      if (error || !data) {
        setAccessDeniedMsg("User record not found. Contact IT.");
        setIsAuthenticated(false);
        setTenantId(null);
        setInstituteCode("");
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      if (data.role !== "admin") {
        setAccessDeniedMsg("Access denied. This portal is for administrators only.");
        setIsAuthenticated(false);
        setTenantId(null);
        setInstituteCode("");
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      setAccessDeniedMsg("");
      setTenantId(data.tenant_id);
      
      // Resolve institute code dynamically from the join
      if (data.tenants && Array.isArray(data.tenants)) {
        setInstituteCode(data.tenants[0]?.institute_code || "Unknown");
      } else if (data.tenants) {
        // @ts-ignore
        setInstituteCode(data.tenants.institute_code || "Unknown");
      }
      
      setIsAuthenticated(true);
      setLoading(false);
    };

    // Grab current session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setLoading(false);
      } else {
        handleSession(session);
      }
    });

    // Listen to changes (login, logout, refresh)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        handleSession(session);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-gray-100 font-bold text-[#1a237e]">Authorizing Session...</div>;
  }

  if (!isAuthenticated || !tenantId) {
    return (
      <>
        {accessDeniedMsg && (
          <div className="absolute top-0 w-full p-4 bg-red-600 font-bold text-white text-center z-50 shadow-md">
            {accessDeniedMsg}
          </div>
        )}
        <LoginScreen />
      </>
    );
  }

  return <MainDashboard tenantId={tenantId} instituteCode={instituteCode} />;
}
