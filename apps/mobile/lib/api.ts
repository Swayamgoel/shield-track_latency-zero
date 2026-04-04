import {
  ApiErrorResponse,
  EndTripResponse,
  DriverLoginRequest,
  LoginResponse,
  ParentLoginRequest,
  SosRequest,
  SosResponse,
  StartTripResponse,
  TodayAssignment,
  TodayAssignmentFull,
  Trip,
} from '@shieldtrack/types';
import { loadSession } from './session';

type ApiSuccess<T> = { ok: true; data: T; status: number };
type ApiFailure = { ok: false; error: ApiErrorResponse; status: number };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const DEFAULT_TIMEOUT_MS = 10000;

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:3001';

const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS === '1';

const API_PATHS = {
  login: '/auth/login',
  driverLogin: '/auth/driver-login',
  todayAssignment: '/driver/assignment/today',
  startTrip: '/driver/trips/start',               // Body: { assignment_id }
  endTrip: (tripId: string) => `/driver/trips/${tripId}/end`,
  updateLocation: (tripId: string) => `/driver/trips/${tripId}/location`,
  triggerSos: '/sos',
};

const nowIso = () => new Date().toISOString();

const defaultError = (status: number, message: string): ApiErrorResponse => ({
  error: {
    code: status ? `HTTP_${status}` : 'NETWORK_ERROR',
    message,
  },
});

const parseError = async (res: Response): Promise<ApiErrorResponse> => {
  try {
    const json = (await res.json()) as ApiErrorResponse;
    if (json?.error?.message) return json;
  } catch {
    // Ignore JSON parse errors and fall back to default.
  }
  return defaultError(res.status, res.statusText || 'Request failed');
};

// ─── Auth header helper ────────────────────────────────────────────────────────
// Reads the stored DriverSession from AsyncStorage and returns a Bearer header.
// Returns empty object if no session is found (will result in 401 from API).
const getAuthHeaders = async (): Promise<HeadersInit> => {
  const session = await loadSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
};

// ─── Core fetch wrapper ────────────────────────────────────────────────────────
const requestJson = async <T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<ApiResult<T>> => {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const error = await parseError(res);
      return { ok: false, error, status: res.status };
    }

    const data = (await res.json()) as T;
    return { ok: true, data, status: res.status };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Network request failed';
    return { ok: false, error: defaultError(0, message), status: 0 };
  } finally {
    clearTimeout(timeout);
  }
};

// ─── Mock data ────────────────────────────────────────────────────────────────
const mockTrip = (tripId: string): Trip => ({
  id: tripId,
  tenant_id: 'tenant_mock_1',
  assignment_id: 'assign_mock_1',
  bus_id: 'bus_mock_1',
  route_id: 'route_mock_1',
  driver_id: 'driver_mock_1',
  status: 'active',
  started_at: nowIso(),
});

const mockLogin = async (): Promise<ApiResult<LoginResponse>> => ({
  ok: true,
  status: 200,
  data: {
    session: {
      user_id: 'user_mock_1',
      tenant_id: 'tenant_mock_1',
      driver_id: 'driver_mock_1',
      role: 'driver',
      access_token: 'mock_access_token',
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  },
});

const mockParentLogin = async (): Promise<ApiResult<LoginResponse>> => ({
  ok: true,
  status: 200,
  data: {
    session: {
      user_id: 'user_mock_parent',
      tenant_id: 'tenant_mock_1',
      student_id: 'student_mock_1',
      bus_id: 'bus_mock_1',
      role: 'parent',
      access_token: 'mock_access_token_parent',
      refresh_token: 'mock_refresh_token_parent',
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  },
});

const mockAssignment = async (): Promise<ApiResult<TodayAssignmentFull>> => ({
  ok: true,
  status: 200,
  data: {
    assignment_id: 'assign_mock_1',
    trip_id: null,
    tenant_id: 'tenant_mock_1',
    bus_id: 'bus_mock_1',
    bus_plate: 'MH-12-AB-1234',
    route_id: 'route_mock_1',
    route_name: 'Morning Route A',
    driver_id: 'driver_mock_1',
    status: 'assigned',
  },
});

const mockStartTrip = async (): Promise<ApiResult<StartTripResponse>> => ({
  ok: true,
  status: 200,
  data: { trip: mockTrip('trip_mock_started_1') },
});

const mockEndTrip = async (tripId: string): Promise<ApiResult<EndTripResponse>> => ({
  ok: true,
  status: 200,
  data: {
    trip: {
      ...mockTrip(tripId),
      status: 'completed',
      ended_at: nowIso(),
    },
  },
});

const mockSos = async (): Promise<ApiResult<SosResponse>> => ({
  ok: true,
  status: 200,
  data: { sos_id: 'sos_mock_1', triggered_at: nowIso() },
});

// ─── API Client ────────────────────────────────────────────────────────────────
export const apiClient = {
  // ── Driver login (Custom API) ─────────────────────────────────────
  login: async (payload: DriverLoginRequest): Promise<ApiResult<LoginResponse>> => {
    if (USE_MOCKS) return mockLogin();

    return requestJson<LoginResponse>(API_PATHS.driverLogin, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ── Parent login (custom Node API → minted JWT) ──────────────────────────────
  parentLogin: async (payload: ParentLoginRequest): Promise<ApiResult<LoginResponse>> => {
    if (USE_MOCKS) return mockParentLogin();
    return requestJson<LoginResponse>(API_PATHS.login, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ── Get today's assignment ───────────────────────────────────────────────────
  getTodayAssignment: async (): Promise<ApiResult<TodayAssignmentFull>> => {
    if (USE_MOCKS) return mockAssignment();
    const headers = await getAuthHeaders();
    return requestJson<TodayAssignmentFull>(API_PATHS.todayAssignment, {
      method: 'GET',
      headers,
    });
  },

  // ── Start trip (creates trip row for the assignment) ─────────────────────────
  startTrip: async (assignmentId: string): Promise<ApiResult<StartTripResponse>> => {
    if (USE_MOCKS) return mockStartTrip();
    const headers = await getAuthHeaders();
    return requestJson<StartTripResponse>(API_PATHS.startTrip, {
      method: 'POST',
      body: JSON.stringify({ assignment_id: assignmentId }),
      headers,
    });
  },

  // ── Update Location ──────────────────────────────────────────────────────────
  updateLocation: async (
    tripId: string,
    payload: { bus_id: string; lat: number; lng: number; speed_kmh: number; recorded_at: string }
  ): Promise<ApiResult<{ success: boolean }>> => {
    if (USE_MOCKS) return { ok: true, status: 200, data: { success: true } };
    const headers = await getAuthHeaders();
    return requestJson<{ success: boolean }>(API_PATHS.updateLocation(tripId), {
      method: 'POST',
      body: JSON.stringify(payload),
      headers,
    });
  },

  // ── End trip ─────────────────────────────────────────────────────────────────
  endTrip: async (tripId: string): Promise<ApiResult<EndTripResponse>> => {
    if (USE_MOCKS) return mockEndTrip(tripId);
    const headers = await getAuthHeaders();
    return requestJson<EndTripResponse>(API_PATHS.endTrip(tripId), {
      method: 'POST',
      headers,
    });
  },

  // ── Trigger SOS ──────────────────────────────────────────────────────────────
  triggerSos: async (payload: SosRequest): Promise<ApiResult<SosResponse>> => {
    if (USE_MOCKS) return mockSos();
    const headers = await getAuthHeaders();
    return requestJson<SosResponse>(API_PATHS.triggerSos, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers,
    });
  },
};
