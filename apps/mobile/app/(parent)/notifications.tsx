import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { DeviationAlert, ParentSession, SOSEvent } from '@shieldtrack/types';
import { getAlertCacheSnapshot, subscribeAlertCache, type AlertFeedItem, upsertAlert, upsertAlerts } from '../../lib/alertsCache';
import { loadSession } from '../../lib/session';
import { supabase } from '../../lib/supabase';

function formatRelativeTime(iso: string): string {
	const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
	if (mins < 1) return 'Just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

function AlertRow({ item }: { item: AlertFeedItem }) {
	const isSos = item.kind === 'sos';
	const accent = isSos ? '#ff3b30' : '#ff9f0a';
	const title = isSos ? 'SOS Event' : 'Route Deviation';
	const subtitle = isSos
		? 'Emergency trigger received from driver.'
		: `Bus went ${Math.round((item.data as DeviationAlert).distance_m)}m away from route.`;

	return (
		<View
			style={{
				flexDirection: 'row',
				alignItems: 'flex-start',
				gap: 12,
				backgroundColor: '#15151a',
				borderRadius: 16,
				padding: 14,
				marginBottom: 10,
				borderLeftWidth: 4,
				borderLeftColor: accent,
			}}
		>
			<View
				style={{
					width: 36,
					height: 36,
					borderRadius: 10,
					alignItems: 'center',
					justifyContent: 'center',
					backgroundColor: isSos ? 'rgba(255, 59, 48, 0.16)' : 'rgba(255, 159, 10, 0.16)',
				}}
			>
				<Ionicons name={isSos ? 'warning' : 'alert-circle'} size={18} color={accent} />
			</View>
			<View style={{ flex: 1 }}>
				<Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{title}</Text>
				<Text style={{ color: '#a5a5b0', fontSize: 13, marginTop: 4 }}>{subtitle}</Text>
				<Text style={{ color: '#6f6f7a', fontSize: 11, marginTop: 6 }}>
					{formatRelativeTime(item.data.triggered_at)}
				</Text>
			</View>
		</View>
	);
}

export default function NotificationsScreen() {
	const router = useRouter();
	const [session, setSession] = useState<ParentSession | null>(null);
	const [alerts, setAlerts] = useState<AlertFeedItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const busId = session?.bus_id ?? null;

	useEffect(() => {
		let mounted = true;
		loadSession()
			.then((s) => {
				if (!mounted) return;
				if (s?.role === 'parent') {
					setSession(s);
				} else {
					setError('Parent session not found. Please login again.');
				}
			})
			.catch(() => {
				if (!mounted) return;
				setError('Unable to load session.');
			})
			.finally(() => {
				if (!mounted) return;
				setLoading(false);
			});

		return () => {
			mounted = false;
		};
	}, []);

	useEffect(() => {
		const unsub = subscribeAlertCache((snapshot) => {
			setAlerts(snapshot);
		});
		return unsub;
	}, []);

	useEffect(() => {
		if (!busId) return;

		setAlerts(getAlertCacheSnapshot(100));

		const fetchHistory = async () => {
			const [sos, dev] = await Promise.all([
				supabase
					.from('sos_events')
					.select('*')
					.eq('bus_id', busId)
					.order('triggered_at', { ascending: false })
					.limit(60),
				supabase
					.from('deviation_alerts')
					.select('*')
					.eq('bus_id', busId)
					.order('triggered_at', { ascending: false })
					.limit(60),
			]);

			if (sos.error || dev.error) {
				setError('Unable to load historical alerts right now.');
				return;
			}

			setError(null);
			const combined: AlertFeedItem[] = [
				...((sos.data ?? []).map((item) => ({ kind: 'sos', data: item as SOSEvent }) as AlertFeedItem)),
				...((dev.data ?? []).map((item) => ({ kind: 'deviation', data: item as DeviationAlert }) as AlertFeedItem)),
			];
			upsertAlerts(combined);
		};

		void fetchHistory();

		const channel = supabase
			.channel(`parent-alerts-screen-${busId}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'sos_events',
					filter: `bus_id=eq.${busId}`,
				},
				(payload) => {
					upsertAlert({ kind: 'sos', data: payload.new as SOSEvent });
				},
			)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'deviation_alerts',
					filter: `bus_id=eq.${busId}`,
				},
				(payload) => {
					upsertAlert({ kind: 'deviation', data: payload.new as DeviationAlert });
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [busId]);

	const title = useMemo(() => {
		if (!busId) return 'Alerts unavailable';
		return 'Alerts & Notifications';
	}, [busId]);

	return (
		<View style={{ flex: 1, backgroundColor: '#0c0c0f' }}>
			<View
				style={{
					paddingTop: 56,
					paddingBottom: 14,
					paddingHorizontal: 20,
					borderBottomWidth: 1,
					borderBottomColor: '#1f1f26',
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'space-between',
				}}
			>
				<View>
					<Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.4 }}>{title}</Text>
					<Text style={{ color: '#8a8a94', fontSize: 12, marginTop: 2 }}>Red: SOS • Orange: Route deviation</Text>
				</View>
				<Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 4 }}>
					<Ionicons name="arrow-back" size={22} color="#c4c4ce" />
				</Pressable>
			</View>

			{loading ? (
				<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
					<ActivityIndicator size="large" color="#2574ff" />
					<Text style={{ color: '#8a8a94', fontSize: 14 }}>Loading alerts…</Text>
				</View>
			) : error ? (
				<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
					<Text style={{ color: '#ff3b30', fontSize: 14, textAlign: 'center' }}>{error}</Text>
				</View>
			) : !busId || alerts.length === 0 ? (
				<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 }}>
					<Ionicons name="checkmark-circle" size={54} color="#34c759" />
					<Text style={{ color: '#fff', fontSize: 19, fontWeight: '700', textAlign: 'center' }}>No active alerts</Text>
					<Text style={{ color: '#8a8a94', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
						Your bus is currently running without SOS or route deviation alerts.
					</Text>
				</View>
			) : (
				<FlatList
					data={alerts}
					keyExtractor={(item) => `${item.kind}-${item.data.id}`}
					renderItem={({ item }) => <AlertRow item={item} />}
					contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
					showsVerticalScrollIndicator={false}
				/>
			)}
		</View>
	);
}
