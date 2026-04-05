import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { loadSession } from '../../lib/session';
import { useBusRealtime } from '../../hooks/useBusRealtime';
import { supabase } from '../../lib/supabase';
import type { ParentSession } from '@shieldtrack/types';
import NotificationsPanel from './NotificationsPanel';

const PLACEHOLDER_DISTANCE_M = 3500;

const INITIAL_REGION = {
	latitude: 20.5937,
	longitude: 78.9629,
	latitudeDelta: 0.05,
	longitudeDelta: 0.05,
};

type LatLngPoint = { latitude: number; longitude: number };

function parseRoutePolyline(raw: unknown): LatLngPoint[] {
	if (!Array.isArray(raw)) return [];
	const parsed = raw
		.map((point) => {
			if (!point || typeof point !== 'object') return null;
			const p = point as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
			const lat = typeof p.lat === 'number' ? p.lat : typeof p.latitude === 'number' ? p.latitude : null;
			const lng = typeof p.lng === 'number' ? p.lng : typeof p.longitude === 'number' ? p.longitude : null;
			if (lat === null || lng === null) return null;
			return { latitude: lat, longitude: lng };
		})
		.filter((point): point is LatLngPoint => point !== null);

	return parsed;
}

// ─── Alert Banner ─────────────────────────────────────────────────────────────

function AlertBanner({
	type,
	message,
	onDismiss,
}: {
	type: 'sos' | 'deviation';
	message: string;
	onDismiss: () => void;
}) {
	const slideAnim = useRef(new Animated.Value(-100)).current;

	useEffect(() => {
		Animated.spring(slideAnim, {
			toValue: 0,
			useNativeDriver: true,
			tension: 80,
			friction: 10,
		}).start();
		const timer = setTimeout(() => dismissWithAnim(), 8000);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const dismissWithAnim = () => {
		Animated.timing(slideAnim, {
			toValue: -120,
			duration: 250,
			useNativeDriver: true,
		}).start(() => onDismiss());
	};

	const bgColor = type === 'sos' ? '#ff3b30' : '#ff9f0a';

	return (
		<Animated.View
			style={{
				position: 'absolute',
				top: 0, left: 0, right: 0,
				zIndex: 100,
				flexDirection: 'row',
				alignItems: 'center',
				justifyContent: 'space-between',
				paddingTop: 52, paddingBottom: 14, paddingHorizontal: 18,
				backgroundColor: bgColor,
				transform: [{ translateY: slideAnim }],
			}}
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 }}>
				<Ionicons name={type === 'sos' ? 'warning' : 'alert-circle'} size={20} color="#fff" />
				<Text style={{ color: '#fff', fontWeight: '600', fontSize: 14, flex: 1 }} numberOfLines={2}>
					{message}
				</Text>
			</View>
			<Pressable onPress={dismissWithAnim} hitSlop={10}>
				<Ionicons name="close" size={18} color="#fff" />
			</Pressable>
		</Animated.View>
	);
}

// ─── ETA Card ─────────────────────────────────────────────────────────────────

function ETACard({
	etaMinutes,
	etaTime,
	busOnline,
}: {
	etaMinutes: number | null;
	etaTime: string | null;
	busOnline: boolean;
}) {
	const statusLabel = busOnline ? 'On Time' : 'Not Started';
	const statusBg = busOnline ? '#dce9dc' : '#2a1a0a';
	const statusFg = busOnline ? '#166534' : '#ff9f0a';

	return (
		<>
			<View
				style={{
					position: 'absolute',
					top: 12,
					left: 12,
					backgroundColor: 'rgba(255, 255, 255, 0.93)',
					paddingHorizontal: 14,
					paddingVertical: 10,
					borderRadius: 16,
					minWidth: 148,
				}}
			>
				<Text style={{ color: '#0b3d16', fontSize: 34, fontWeight: '800' }}>
					{etaMinutes !== null ? `${etaMinutes} min` : '--'}
				</Text>
				<Text style={{ color: '#2f3a31', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 1 }}>
					Estimated Arrival
				</Text>
				{etaTime ? <Text style={{ color: '#4f5d54', fontSize: 11, marginTop: 2 }}>~ {etaTime}</Text> : null}
			</View>

			<View
				style={{
					position: 'absolute',
					top: 18,
					right: 14,
					backgroundColor: statusBg,
					paddingHorizontal: 14,
					paddingVertical: 8,
					borderRadius: 20,
				}}
			>
				<Text style={{ color: statusFg, fontSize: 14, fontWeight: '700' }}>{statusLabel}</Text>
			</View>
		</>
	);
}

// ─── Trip Summary Card ───────────────────────────────────────────────────────

function TripSummaryCard({
	studentName,
	studentRegistration,
	busPlate,
	busId,
	driverLabel,
	routeName,
	busOnline,
	connected,
	speedKmh,
	etaMinutes,
}: {
	studentName: string | null;
	studentRegistration: string | null;
	busPlate: string | null;
	busId: string | null;
	driverLabel: string | null;
	routeName: string | null;
	busOnline: boolean;
	connected: boolean;
	speedKmh: number;
	etaMinutes: number | null;
}) {
	const shortBus = busId ? `#${busId.slice(0, 8).toUpperCase()}` : '#PENDING';
	const busPlateLabel = busPlate ? busPlate : 'UNASSIGNED';
	const stateLabel = busOnline ? 'Online' : 'Standby';
	const stateColor = busOnline ? '#15803d' : '#9a6700';

	return (
		<View
			style={{
				backgroundColor: '#f8f8f9',
				paddingHorizontal: 22,
				paddingTop: 22,
				paddingBottom: 60,
				flex: 1,
				minHeight: '100%',
			}}
		>
			<Text style={{ color: '#166534', fontSize: 30, fontWeight: '900', letterSpacing: -0.8 }} numberOfLines={1}>
				{studentName ? studentName : 'Student Name'}
			</Text>

			<View style={{ marginTop: 8, marginBottom: 8 }}>
				<Text style={{ color: '#4b5563', fontSize: 14, marginBottom: 3 }}>
					Address: Not specified
				</Text>
				<Text style={{ color: '#4b5563', fontSize: 14 }}>
					Reg No: {studentRegistration ? studentRegistration : 'N/A'}
				</Text>
			</View>

			<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
				<View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 12 }}>
					<View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: '#e7efe7', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
						<Ionicons name="bus" size={24} color="#166534" />
					</View>
					<View style={{ flex: 1 }}>
						<Text style={{ color: '#1f2937', fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{busPlateLabel}</Text>
						<Text style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }} numberOfLines={1}>ID {shortBus}</Text>
					</View>
				</View>
				<View style={{ backgroundColor: '#ecf1ed', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 }}>
					<Text style={{ color: stateColor, fontSize: 13, fontWeight: '800' }}>{stateLabel}</Text>
				</View>
			</View>

			<View style={{ marginTop: 22 }}>
				<Text style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>Route</Text>
				<Text style={{ color: '#111827', fontSize: 15, fontWeight: '600' }} numberOfLines={2}>
					{routeName ? routeName : 'No route details Yet'}
				</Text>
			</View>

			<View style={{ marginTop: 18 }}>
				<Text style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>Driver</Text>
				<Text style={{ color: '#111827', fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
					{driverLabel ? driverLabel : 'Driver not assigned'}
				</Text>
			</View>

			<View style={{ marginTop: 22, backgroundColor: '#ececef', borderRadius: 16, padding: 18 }}>
				<View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
					<View style={{ alignItems: 'flex-start', flex: 1 }}>
						<Text style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 }}>ETA</Text>
						<Text style={{ color: '#111827', fontSize: 18, fontWeight: '800', marginTop: 4 }}>
							{etaMinutes !== null ? `${etaMinutes} min` : '--'}
						</Text>
					</View>
					<View style={{ alignItems: 'flex-start', flex: 1 }}>
						<Text style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 }}>Speed</Text>
						<Text style={{ color: '#111827', fontSize: 18, fontWeight: '800', marginTop: 4 }}>
							{busOnline ? `${speedKmh.toFixed(0)} km/h` : '0 km/h'}
						</Text>
					</View>
					<View style={{ alignItems: 'flex-end', flex: 1 }}>
						<Text style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 }}>Link</Text>
						<Text style={{ color: connected ? '#15803d' : '#9ca3af', fontSize: 16, fontWeight: '800', marginTop: 4 }}>
							{connected ? 'Live' : 'Syncing'}
						</Text>
					</View>
				</View>
			</View>
		</View>
	);
}

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────

function TabBar({
	activeTab,
	onSwitch,
}: {
	activeTab: 'tracker' | 'alerts';
	onSwitch: (tab: 'tracker' | 'alerts') => void;
}) {
	return (
		<View
			style={{
				flexDirection: 'row',
				backgroundColor: '#0c0c0f',
				borderTopWidth: 1,
				borderTopColor: '#212127',
				height: 64,
				paddingBottom: 10,
				paddingTop: 6,
			}}
		>
			<Pressable
				onPress={() => onSwitch('tracker')}
				style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
			>
				<Ionicons
					name="navigate"
					size={22}
					color={activeTab === 'tracker' ? '#2574ff' : '#555570'}
				/>
				<Text style={{ fontSize: 11, fontWeight: '600', color: activeTab === 'tracker' ? '#2574ff' : '#555570' }}>
					Live Tracker
				</Text>
			</Pressable>
			<Pressable
				onPress={() => onSwitch('alerts')}
				style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
			>
				<Ionicons
					name="notifications"
					size={22}
					color={activeTab === 'alerts' ? '#2574ff' : '#555570'}
				/>
				<Text style={{ fontSize: 11, fontWeight: '600', color: activeTab === 'alerts' ? '#2574ff' : '#555570' }}>
					Alerts
				</Text>
			</Pressable>
		</View>
	);
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function TrackerScreen() {
	const router = useRouter();
	const mapRef = useRef<MapView>(null);

	const [session, setSession] = useState<ParentSession | null>(null);
	const [activeTab, setActiveTab] = useState<'tracker' | 'alerts'>('tracker');
	const [activeBanner, setActiveBanner] = useState<{
		type: 'sos' | 'deviation';
		message: string;
		key: string;
	} | null>(null);
	const [bannerQueue, setBannerQueue] = useState<
		{ type: 'sos' | 'deviation'; message: string; key: string }[]
	>([]);
	const [routePolyline, setRoutePolyline] = useState<LatLngPoint[]>([]);
	const [routeName, setRouteName] = useState<string | null>(null);
	const [studentName, setStudentName] = useState<string | null>(null);
	const [studentRegistration, setStudentRegistration] = useState<string | null>(null);
	const [busPlate, setBusPlate] = useState<string | null>(null);
	const [driverLabel, setDriverLabel] = useState<string | null>(null);
	const [resolvedBusId, setResolvedBusId] = useState<string | null>(null);
	const bannerKeysRef = useRef<Set<string>>(new Set());
	const { height: windowHeight } = useWindowDimensions();

	const enqueueBanner = useCallback((banner: { type: 'sos' | 'deviation'; message: string; key: string }) => {
		if (bannerKeysRef.current.has(banner.key)) return;
		bannerKeysRef.current.add(banner.key);
		setBannerQueue((prev) => [...prev, banner]);
	}, []);

	useEffect(() => {
		loadSession().then((s) => {
			if (s?.role === 'parent') setSession(s);
		});
	}, []);

	const busId = resolvedBusId ?? session?.bus_id ?? null;
	const { location, busOnline, eta, sosEvent, deviationAlert, connected } =
		useBusRealtime({ busId, distanceMetres: PLACEHOLDER_DISTANCE_M });
	const markerIsLive = busOnline && Boolean(location);
	const sheetExpandedHeight = Math.max(480, Math.round(windowHeight * 0.55));
	const sheetPeekHeight = 176;
	const sheetCollapsedOffset = Math.max(0, sheetExpandedHeight - sheetPeekHeight);
	const sheetTranslateY = useRef(new Animated.Value(sheetCollapsedOffset)).current;
	const panStartY = useRef(sheetCollapsedOffset);

	const snapSheet = useCallback((toExpanded: boolean) => {
		Animated.spring(sheetTranslateY, {
			toValue: toExpanded ? 0 : sheetCollapsedOffset,
			useNativeDriver: true,
			tension: 110,
			friction: 14,
		}).start();
	}, [sheetCollapsedOffset, sheetTranslateY]);

	const panResponder = useRef(
		PanResponder.create({
			onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5,
			onPanResponderGrant: () => {
				sheetTranslateY.stopAnimation((value) => {
					panStartY.current = value;
				});
			},
			onPanResponderMove: (_, gesture) => {
				const next = Math.min(sheetCollapsedOffset, Math.max(0, panStartY.current + gesture.dy));
				sheetTranslateY.setValue(next);
			},
			onPanResponderRelease: (_, gesture) => {
				const projected = panStartY.current + gesture.dy;
				const threshold = sheetCollapsedOffset * 0.42;
				snapSheet(projected < threshold);
			},
		})
	).current;

	useEffect(() => {
		sheetTranslateY.setValue(sheetCollapsedOffset);
	}, [sheetCollapsedOffset, sheetTranslateY]);

	const centerMapOnBus = useCallback(() => {
		if (!location || !mapRef.current || activeTab !== 'tracker') return;
		mapRef.current.animateToRegion(
			{ latitude: location.lat, longitude: location.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
			420,
		);
	}, [activeTab, location]);

	useEffect(() => {
		if (!busId) {
			setRoutePolyline([]);
			setRouteName(null);
			return;
		}

		let active = true;

		const loadRouteShape = async () => {
			setRoutePolyline([]);
			setRouteName(null);

			// Read active trip route for this bus, then render polyline when available.
			const { data: trip } = await supabase
				.from('trips')
				.select('route_id')
				.eq('tenant_id', session?.tenant_id ?? '')
				.eq('bus_id', busId)
				.eq('status', 'active')
				.order('started_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			if (!active || !trip?.route_id) return;

			const { data: route } = await supabase
				.from('routes')
				.select('name, polyline')
				.eq('id', trip.route_id)
				.maybeSingle();

			if (!active || !route) return;

			const points = parseRoutePolyline(route.polyline);
			setRoutePolyline(points);
			setRouteName(typeof route.name === 'string' ? route.name : null);
		};

		void loadRouteShape();

		return () => {
			active = false;
		};
	}, [busId, session?.tenant_id]);

	useEffect(() => {
		if (!session || session.role !== 'parent') {
			setStudentName(null);
			setStudentRegistration(null);
			setBusPlate(null);
			setDriverLabel(null);
			setResolvedBusId(null);
			return;
		}

		let active = true;

		const loadParentTripMeta = async () => {
			setStudentName(null);
			setStudentRegistration(null);
			setBusPlate(null);
			setDriverLabel(null);
			setResolvedBusId(null);

			const { data: student } = await supabase
				.from('students')
				.select('id, name, registration_no, route_id')
				.eq('id', session.student_id)
				.eq('tenant_id', session.tenant_id)
				.maybeSingle();

			if (!active) return;
			setStudentName(student?.name ?? null);
			setStudentRegistration(student?.registration_no ?? null);

			let resolvedBusId = busId;
			let resolvedDriverId: string | null = null;

			if (resolvedBusId) {
				const { data: activeTrip } = await supabase
					.from('trips')
					.select('driver_id')
					.eq('tenant_id', session.tenant_id)
					.eq('bus_id', resolvedBusId)
					.eq('status', 'active')
					.order('started_at', { ascending: false })
					.limit(1)
					.maybeSingle();

				resolvedDriverId = (activeTrip?.driver_id as string | undefined) ?? null;
			}

			if ((!resolvedBusId || !resolvedDriverId) && student?.route_id) {
				const today = new Date().toISOString().slice(0, 10);
				const { data: assignment } = await supabase
					.from('trip_assignments')
					.select('bus_id, driver_id')
					.eq('tenant_id', session.tenant_id)
					.eq('route_id', student.route_id)
					.eq('assigned_date', today)
					.order('created_at', { ascending: false })
					.limit(1)
					.maybeSingle();

				if (!resolvedBusId) {
					resolvedBusId = (assignment?.bus_id as string | undefined) ?? null;
				}
				if (!resolvedDriverId) {
					resolvedDriverId = (assignment?.driver_id as string | undefined) ?? null;
				}
			}

			setResolvedBusId(resolvedBusId ?? null);

			if (resolvedBusId) {
				const { data: bus } = await supabase
					.from('buses')
					.select('plate_number')
					.eq('tenant_id', session.tenant_id)
					.eq('id', resolvedBusId)
					.maybeSingle();

				if (!active) return;
				setBusPlate((bus?.plate_number as string | undefined) ?? null);
			} else {
				setBusPlate(null);
			}

			if (resolvedDriverId) {
				const { data: driver } = await supabase
					.from('users')
					.select('email')
					.eq('tenant_id', session.tenant_id)
					.eq('id', resolvedDriverId)
					.maybeSingle();

				if (!active) return;
				setDriverLabel((driver?.email as string | undefined) ?? null);
			} else {
				setDriverLabel(null);
			}
		};

		void loadParentTripMeta();

		return () => {
			active = false;
		};
	}, [busId, session]);

	useEffect(() => {
		if (activeBanner || bannerQueue.length === 0) return;
		setActiveBanner(bannerQueue[0]);
		setBannerQueue((prev) => prev.slice(1));
	}, [activeBanner, bannerQueue]);

	useEffect(() => {
		if (!sosEvent) return;
		enqueueBanner({
			type: 'sos',
			message: "🚨 Emergency SOS triggered on your child's bus!",
			key: sosEvent.id,
		});
	}, [enqueueBanner, sosEvent]);

	useEffect(() => {
		if (!deviationAlert) return;
		enqueueBanner({
			type: 'deviation',
			message: `⚠️ Bus is ${Math.round(deviationAlert.distance_m)}m off the planned route.`,
			key: deviationAlert.id,
		});
	}, [deviationAlert, enqueueBanner]);

	useEffect(() => {
		centerMapOnBus();
	}, [centerMapOnBus]);

	useEffect(() => {
		if (!location || activeTab !== 'tracker') return;
		const timer = setInterval(() => {
			centerMapOnBus();
		}, 4500);

		return () => clearInterval(timer);
	}, [activeTab, centerMapOnBus, location]);

	return (
		<View style={{ flex: 1, backgroundColor: '#0c0c0f' }}>
			{/* Alert Banner */}
			{activeBanner && (
				<AlertBanner
					key={activeBanner.key}
					type={activeBanner.type}
					message={activeBanner.message}
					onDismiss={() => setActiveBanner(null)}
				/>
			)}

			{/* Header */}
			<View style={{
				flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
				paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, backgroundColor: '#0c0c0f',
				borderBottomWidth: 1,
				borderBottomColor: '#202027',
			}}>
				<View>
					<Text style={{ fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5 }}>
						{activeTab === 'tracker' ? 'Live Tracker' : 'Alerts'}
					</Text>
					{activeTab === 'tracker' && (
						<View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 5 }}>
							<View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? '#34c759' : '#555' }} />
							<Text style={{ fontSize: 12, color: '#888' }}>{connected ? 'Connected' : 'Connecting…'}</Text>
						</View>
					)}
				</View>
				<Pressable onPress={() => router.replace('/login')} style={{ padding: 4 }} hitSlop={8}>
					<Ionicons name="log-out-outline" size={22} color="#888" />
				</Pressable>
			</View>

			{/* Content */}
			<View style={{ flex: 1 }}>
				{activeTab === 'tracker' ? (
					<View style={{ flex: 1, backgroundColor: '#f4f4f6' }}>
						<View style={{ flex: 1, overflow: 'hidden' }}>
							<MapView
								ref={mapRef}
								provider={PROVIDER_DEFAULT}
								style={{ flex: 1 }}
								initialRegion={INITIAL_REGION}
								showsUserLocation={false}
								showsCompass={false}
							>
								{routePolyline.length > 1 && (
									<Polyline
										coordinates={routePolyline}
										strokeColor="rgba(22, 101, 52, 0.75)"
										strokeWidth={5}
									/>
								)}
								{location && (
									<Marker
										coordinate={{ latitude: location.lat, longitude: location.lng }}
										anchor={{ x: 0.5, y: 0.5 }}
									>
										<View
											style={{
												width: markerIsLive ? 56 : 46,
												height: markerIsLive ? 56 : 46,
												borderRadius: markerIsLive ? 28 : 10,
												backgroundColor: markerIsLive ? '#166534' : '#e5e7eb',
												alignItems: 'center',
												justifyContent: 'center',
												borderWidth: markerIsLive ? 4 : 1,
												borderColor: markerIsLive ? 'rgba(255,255,255,0.9)' : '#9ca3af',
											}}
										>
											<Ionicons name={markerIsLive ? 'bus' : 'bus-outline'} size={22} color={markerIsLive ? '#fff' : '#4b5563'} />
										</View>
									</Marker>
								)}
							</MapView>
							<ETACard etaMinutes={eta.etaMinutes} etaTime={eta.etaTime} busOnline={markerIsLive} />
						</View>

						<Animated.View
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
									bottom: 0,
								height: sheetExpandedHeight,
								backgroundColor: '#f8f8f9',
								borderTopLeftRadius: 28,
								borderTopRightRadius: 28,
								borderBottomLeftRadius: 0,
								borderBottomRightRadius: 0,
								overflow: 'hidden',
								transform: [{ translateY: sheetTranslateY }],
							}}
							{...panResponder.panHandlers}
						>
							<TripSummaryCard
								studentName={studentName}
								studentRegistration={studentRegistration}
								busPlate={busPlate}
								busId={resolvedBusId ?? busId}
								driverLabel={driverLabel}
								routeName={routeName}
								busOnline={markerIsLive}
								connected={connected}
								speedKmh={location?.speed_kmh ?? 0}
								etaMinutes={eta.etaMinutes}
							/>
						</Animated.View>
					</View>
				) : (
					<NotificationsPanel busId={busId} />
				)}
			</View>

			{/* Custom Tab Bar */}
			<TabBar activeTab={activeTab} onSwitch={setActiveTab} />
		</View>
	);
}
