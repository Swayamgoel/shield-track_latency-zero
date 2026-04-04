import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { loadSession } from '../../lib/session';
import { useBusRealtime } from '../../hooks/useBusRealtime';
import type { ParentSession } from '@shieldtrack/types';
import NotificationsPanel from './NotificationsPanel';

const PLACEHOLDER_DISTANCE_M = 3500;

const INITIAL_REGION = {
	latitude: 20.5937,
	longitude: 78.9629,
	latitudeDelta: 0.05,
	longitudeDelta: 0.05,
};

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
	speedKmh,
}: {
	etaMinutes: number | null;
	etaTime: string | null;
	speedKmh: number;
}) {
	return (
		<View
			style={{
				position: 'absolute',
				bottom: 0, left: 0, right: 0,
				backgroundColor: '#15151a',
				borderTopLeftRadius: 20,
				borderTopRightRadius: 20,
				paddingVertical: 20,
				paddingHorizontal: 24,
				borderTopWidth: 1,
				borderColor: '#1f1f26',
			}}
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
				<View style={{ alignItems: 'center', flex: 1 }}>
					<Text style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>ETA</Text>
					<Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2 }}>
						{etaMinutes !== null ? `${etaMinutes} min` : '—'}
					</Text>
					{etaTime ? <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>~{etaTime}</Text> : null}
				</View>
				<View style={{ width: 1, height: 36, backgroundColor: '#2a2a35' }} />
				<View style={{ alignItems: 'center', flex: 1 }}>
					<Text style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>Speed</Text>
					<Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2 }}>
						{speedKmh.toFixed(0)}
					</Text>
					<Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>km/h</Text>
				</View>
				<View style={{ width: 1, height: 36, backgroundColor: '#2a2a35' }} />
				<View style={{ alignItems: 'center', flex: 1 }}>
					<Text style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>Status</Text>
					<View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a2a14', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4, gap: 5 }}>
						<View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#34c759' }} />
						<Text style={{ color: '#34c759', fontSize: 12, fontWeight: '600' }}>Online</Text>
					</View>
				</View>
			</View>
		</View>
	);
}

// ─── Offline State ────────────────────────────────────────────────────────────

function OfflineState() {
	return (
		<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
			<View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#0d1a33', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
				<Ionicons name="bus" size={48} color="#2574ff" />
			</View>
			<Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
				Bus hasn't started yet
			</Text>
			<Text style={{ color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
				You'll see the live position as soon as the driver goes online.
			</Text>
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
				backgroundColor: '#15151a',
				borderTopWidth: 1,
				borderTopColor: '#1f1f26',
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

	useEffect(() => {
		loadSession().then((s) => {
			if (s?.role === 'parent') setSession(s);
		});
	}, []);

	const busId = session?.bus_id ?? null;

	const { location, busOnline, eta, sosEvent, deviationAlert, connected } =
		useBusRealtime({ busId, distanceMetres: PLACEHOLDER_DISTANCE_M });

	useEffect(() => {
		if (!sosEvent) return;
		setActiveBanner({
			type: 'sos',
			message: "🚨 Emergency SOS triggered on your child's bus!",
			key: sosEvent.id,
		});
	}, [sosEvent]);

	useEffect(() => {
		if (!deviationAlert) return;
		setActiveBanner({
			type: 'deviation',
			message: `⚠️ Bus is ${Math.round(deviationAlert.distance_m)}m off the planned route.`,
			key: deviationAlert.id,
		});
	}, [deviationAlert]);

	useEffect(() => {
		if (!location || !mapRef.current) return;
		mapRef.current.animateToRegion(
			{ latitude: location.lat, longitude: location.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
			600,
		);
	}, [location]);

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
					busOnline && location ? (
						<View style={{ flex: 1 }}>
							<MapView
								ref={mapRef}
								provider={PROVIDER_DEFAULT}
								style={{ flex: 1 }}
								initialRegion={INITIAL_REGION}
								showsUserLocation={false}
								showsCompass={false}
							>
								<Marker
									coordinate={{ latitude: location.lat, longitude: location.lng }}
									anchor={{ x: 0.5, y: 0.5 }}
								>
									<View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#2574ff', alignItems: 'center', justifyContent: 'center' }}>
										<Ionicons name="bus" size={18} color="#fff" />
									</View>
								</Marker>
							</MapView>
							<ETACard etaMinutes={eta.etaMinutes} etaTime={eta.etaTime} speedKmh={location.speed_kmh} />
						</View>
					) : (
						<OfflineState />
					)
				) : (
					<NotificationsPanel busId={busId} />
				)}
			</View>

			{/* Custom Tab Bar */}
			<TabBar activeTab={activeTab} onSwitch={setActiveTab} />
		</View>
	);
}
