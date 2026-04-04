import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../../lib/supabase';
import type { DeviationAlert, SOSEvent } from '@shieldtrack/types';

type AlertItem =
	| { kind: 'sos'; data: SOSEvent }
	| { kind: 'deviation'; data: DeviationAlert };

function formatRelativeTime(iso: string): string {
	const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
	if (mins < 1) return 'Just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

function AlertRow({ item }: { item: AlertItem }) {
	const isSos = item.kind === 'sos';
	const accent = isSos ? '#ff3b30' : '#ff9f0a';
	const title = isSos ? '🚨 SOS Alert' : '⚠️ Route Deviation';
	const body = isSos
		? 'Emergency triggered by driver. Authorities have been notified.'
		: `Bus was ${Math.round((item.data as DeviationAlert).distance_m)}m off the planned route.`;
	const resolved = isSos ? !!(item.data as SOSEvent).resolved_at : undefined;
	const chipBg = isSos ? 'rgba(255, 59, 48, 0.16)' : 'rgba(255, 159, 10, 0.16)';

	return (
		<View style={{ flexDirection: 'row', backgroundColor: '#15151a', borderRadius: 16, padding: 14, gap: 12, alignItems: 'flex-start', borderLeftWidth: 4, borderLeftColor: accent, marginBottom: 10 }}>
			<View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: chipBg, alignItems: 'center', justifyContent: 'center' }}>
				<Ionicons name={isSos ? 'warning' : 'alert-circle'} size={20} color={accent} />
			</View>
			<View style={{ flex: 1 }}>
				<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
					<Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{title}</Text>
					{resolved !== undefined && (
						<View style={{ backgroundColor: resolved ? '#0a2a14' : '#2a1a0a', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
							<Text style={{ color: resolved ? '#34c759' : '#ff9f0a', fontSize: 12, fontWeight: '600' }}>
								{resolved ? 'Resolved' : 'Active'}
							</Text>
						</View>
					)}
				</View>
				<Text style={{ color: '#999', fontSize: 13, lineHeight: 18 }} numberOfLines={2}>{body}</Text>
				<Text style={{ color: '#555', fontSize: 11, marginTop: 4 }}>{formatRelativeTime(item.data.triggered_at)}</Text>
			</View>
		</View>
	);
}

export default function NotificationsPanel({ busId }: { busId: string | null }) {
	const [alerts, setAlerts] = useState<AlertItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!busId) {
			setLoading(false);
			return;
		}

		const fetch = async () => {
			setLoading(true);
			const [sos, dev] = await Promise.all([
				supabase.from('sos_events').select('*').eq('bus_id', busId).order('triggered_at', { ascending: false }).limit(50),
				supabase.from('deviation_alerts').select('*').eq('bus_id', busId).order('triggered_at', { ascending: false }).limit(50),
			]);

			if (sos.error || dev.error) {
				setError('Could not load alerts.');
				setLoading(false);
				return;
			}

			const combined: AlertItem[] = [
				...(sos.data ?? []).map((d): AlertItem => ({ kind: 'sos', data: d as SOSEvent })),
				...(dev.data ?? []).map((d): AlertItem => ({ kind: 'deviation', data: d as DeviationAlert })),
			].sort((a, b) => Date.parse(b.data.triggered_at) - Date.parse(a.data.triggered_at));

			setAlerts(combined);
			setLoading(false);
		};

		fetch();
	}, [busId]);

	if (loading) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
				<ActivityIndicator size="large" color="#2574ff" />
				<Text style={{ color: '#666', fontSize: 14 }}>Loading alerts…</Text>
			</View>
		);
	}

	if (error) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
				<Text style={{ color: '#ff3b30', fontSize: 14, textAlign: 'center' }}>{error}</Text>
			</View>
		);
	}

	if (!busId || alerts.length === 0) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }}>
				<Ionicons name="checkmark-circle" size={56} color="#34c759" />
				<Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>All clear!</Text>
				<Text style={{ color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
					No SOS or deviation alerts for your child's bus.
				</Text>
			</View>
		);
	}

	return (
		<FlatList
			data={alerts}
			keyExtractor={(item) => `${item.kind}-${item.data.id}`}
			renderItem={({ item }) => <AlertRow item={item} />}
			contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
			showsVerticalScrollIndicator={false}
		/>
	);
}
