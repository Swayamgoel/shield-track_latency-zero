export interface Tenant { 
  id: string; 
  name: string; 
  institute_code: string; 
}
export interface User { 
  id: string; 
  tenant_id: string; 
  email?: string; 
  role: 'admin'|'driver'|'parent'; 
  device_id?: string; 
  student_id?: string; 
}
export interface Bus { 
  id: string; 
  tenant_id: string; 
  plate_number: string; 
  capacity: number; 
}
export interface Stop { 
  name: string; 
  lat: number; 
  lng: number; 
  order: number; 
}
export interface Route { 
  id: string; 
  tenant_id: string; 
  name: string; 
  polyline: {lat:number,lng:number}[]; 
  stops: Stop[]; 
}
export interface Student { 
  id: string; 
  tenant_id: string; 
  name: string; 
  route_id: string; 
  registration_no: string;
}
export interface TripAssignment { 
  id: string; 
  tenant_id: string; 
  bus_id: string; 
  route_id: string; 
  driver_id: string; 
  assigned_date: string; 
}
export interface Trip { 
  id: string; 
  tenant_id: string; 
  assignment_id: string; 
  bus_id: string; 
  route_id: string; 
  driver_id: string; 
  status: 'active'|'completed'; 
  started_at: string; 
  ended_at?: string; 
}
export interface BusLocation { 
  id: string; 
  trip_id: string; 
  bus_id: string; 
  tenant_id: string; 
  lat: number; 
  lng: number; 
  speed_kmh: number; 
  recorded_at: string; 
}
export interface SOSEvent { 
  id: string; 
  trip_id: string; 
  bus_id: string; 
  tenant_id: string; 
  lat: number; 
  lng: number; 
  triggered_at: string; 
  resolved_at?: string; 
  notes?: string; 
}
export interface DeviationAlert { 
  id: string; 
  trip_id: string; 
  bus_id: string; 
  tenant_id: string; 
  lat: number; 
  lng: number; 
  distance_m: number; 
  triggered_at: string; 
}

export interface DriverLoginRequest {
  email: string;
  institute_code: string;
  device_id: string;
}

export interface ParentLoginRequest {
  institute_code: string;
  registration_no: string;
}

export interface DriverSession {
  user_id: string;
  tenant_id: string;
  driver_id: string;
  role: 'driver';
  access_token: string;
  expires_at: string;
}

export interface ParentSession {
  user_id: string;
  tenant_id: string;
  student_id: string;
  bus_id: string | null; // null until Phase 2 resolves active trip
  role: 'parent';
  access_token: string;
  refresh_token?: string;
  expires_at: string;
}

export interface LoginResponse {
  session: DriverSession | ParentSession;
}

export interface TodayAssignment {
  assignment_id: string;
  trip_id?: string | null;
  bus_id: string;
  route_id: string;
  driver_id: string;
  start_time?: string;
  end_time?: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
}

// Extended response from GET /driver/assignment/today — includes joined bus/route fields
export interface TodayAssignmentFull extends TodayAssignment {
  tenant_id: string;
  bus_plate: string;
  route_name: string;
}

export interface SosRequest {
  trip_id: string;
  bus_id: string;
  lat: number;
  lng: number;
}

export interface SosResponse {
  sos_id: string;
  triggered_at: string;
}

export interface StartTripResponse {
  trip: Trip;
}

export interface EndTripResponse {
  trip: Trip;
}

export interface ApiErrorDetail {
  code?: string;
  message: string;
  field?: string;
}

export interface ApiErrorResponse {
  error: {
    code?: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}