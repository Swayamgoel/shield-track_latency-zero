import { useCallback, useEffect, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { clearSession } from '../../lib/session';
import { apiClient } from '../../lib/api';
import { startLocationBroadcast, stopLocationBroadcast } from '../../lib/locationTask';
import type { TodayAssignmentFull } from '@shieldtrack/types';

// ─── Screen state machine ─────────────────────────────────────────────────────
type ScreenStatus = 'loading' | 'no_assignment' | 'assigned' | 'in_progress' | 'completed' | 'error';

// ─── Status badge colours ─────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
	assigned: '#f59e0b',
	in_progress: '#22c55e',
	completed: '#6b7280',
	no_assignment: '#6b7280',
};

export default function DriverTripScreen() {
	const router = useRouter();

	const [screenStatus, setScreenStatus] = useState<ScreenStatus>('loading');
	const [assignment, setAssignment] = useState<TodayAssignmentFull | null>(null);
	const [tripId, setTripId] = useState<string | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState(false);
	const [broadcasting, setBroadcasting] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

	// ─── Load today's assignment ───────────────────────────────────────────────
	const loadAssignment = useCallback(async () => {
		const result = await apiClient.getTodayAssignment();

		if (!result.ok) {
			if (result.status === 404) {
				setScreenStatus('no_assignment');
			} else {
				setErrorMsg(result.error.error.message);
				setScreenStatus('error');
			}
			return;
		}

		const data = result.data;
		setAssignment(data);
		if (data.trip_id) setTripId(data.trip_id);

		if (data.status === 'in_progress') setScreenStatus('in_progress');
		else if (data.status === 'completed') setScreenStatus('completed');
		else setScreenStatus('assigned');
	}, []);

	useEffect(() => {
		loadAssignment();
	}, [loadAssignment]);

	const handleRefresh = async () => {
		setRefreshing(true);
		await loadAssignment();
		setRefreshing(false);
	};

	// ─── Start Trip ────────────────────────────────────────────────────────────
	const handleStartTrip = async () => {
		if (!assignment || actionLoading) return;
		setActionLoading(true);

		const result = await apiClient.startTrip(assignment.assignment_id);

		if (!result.ok) {
			setActionLoading(false);
			Alert.alert('Start Trip Failed', result.error.error.message);
			return;
		}

		const { trip } = result.data;
		setTripId(trip.id);
		setScreenStatus('in_progress');
		setActionLoading(false);

		// Start GPS broadcast
		try {
			await startLocationBroadcast(trip.id, assignment.bus_id, assignment.tenant_id);
			setBroadcasting(true);
		} catch (e: any) {
			Alert.alert(
				'Location Permission',
				e.message || 'Could not start GPS broadcast. Enable location in Settings.',
			);
		}
	};

	// ─── End Trip ──────────────────────────────────────────────────────────────
	const handleEndTrip = () => {
		Alert.alert(
			'End Trip',
			'Are you sure you want to end this trip? GPS broadcast will stop.',
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'End Trip',
					style: 'destructive',
					onPress: async () => {
						if (!tripId || actionLoading) return;
						setActionLoading(true);

						const result = await apiClient.endTrip(tripId);
						setActionLoading(false);

						if (!result.ok) {
							Alert.alert('Error', result.error.error.message);
							return;
						}

						await stopLocationBroadcast();
						setBroadcasting(false);
						setScreenStatus('completed');
					},
				},
			],
		);
	};

	// ─── SOS ──────────────────────────────────────────────────────────────────
	const handleSOS = () => {
		if (!tripId || !assignment) return;
		router.push({
			pathname: '/sos-confirm',
			params: { trip_id: tripId, bus_id: assignment.bus_id },
		});
	};

	// ─── Logout ────────────────────────────────────────────────────────────────
	const handleLogout = async () => {
		Alert.alert('Logout', 'This will end your session and stop GPS broadcasting.', [
			{ text: 'Cancel', style: 'cancel' },
			{
				text: 'Logout',
				style: 'destructive',
				onPress: async () => {
					await stopLocationBroadcast();
					await clearSession();
					router.replace('/login');
				},
			},
		]);
	};

	// ─── Render helpers ────────────────────────────────────────────────────────
	const renderContent = () => {
		if (screenStatus === 'loading') {
			return (
				<View className="items-center justify-center py-[60px] gap-3">
					<ActivityIndicator color="#2574ff" size="large" />
					<Text className="text-[#888] text-sm text-center leading-5 max-w-[280px]">Loading assignment...</Text>
				</View>
			);
		}

		if (screenStatus === 'error') {
			return (
				<View className="items-center justify-center py-[60px] gap-3">
					<Text className="text-5xl">⚠️</Text>
					<Text className="text-white text-xl font-bold text-center">Could not load assignment</Text>
					<Text className="text-[#888] text-sm text-center leading-5 max-w-[280px]">{errorMsg}</Text>
					<Pressable className="mt-2 bg-primary px-6 py-2.5 rounded-xl" onPress={loadAssignment}>
						<Text className="text-white font-semibold">Retry</Text>
					</Pressable>
				</View>
			);
		}

		if (screenStatus === 'no_assignment') {
			return (
				<View className="items-center justify-center py-[60px] gap-3">
					<Text className="text-5xl">📋</Text>
					<Text className="text-white text-xl font-bold text-center">No Assignment Today</Text>
					<Text className="text-[#888] text-sm text-center leading-5 max-w-[280px]">
						You have no trip assigned for today. Check back later or contact your admin.
					</Text>
				</View>
			);
		}

		if (!assignment) return null;

		return (
			<>
				{/* ── Assignment Card ── */}
				<View className="bg-card rounded-2xl p-5 gap-3.5">
					<Text className="text-[#888] text-xs font-semibold uppercase tracking-widest">Today's Assignment</Text>

					<View className="flex-row items-center gap-3">
						<Text className="text-[28px]">🚌</Text>
						<View>
							<Text className="text-white text-lg font-bold">{assignment.bus_plate}</Text>
							<Text className="text-[#888] text-xs mt-0.5">Bus Plate</Text>
						</View>
					</View>

					<View className="h-[1px] bg-[#1f1f26]" />

					<View className="flex-row items-center gap-3">
						<Text className="text-[28px]">🗺️</Text>
						<View>
							<Text className="text-white text-lg font-bold">{assignment.route_name}</Text>
							<Text className="text-[#888] text-xs mt-0.5">Route</Text>
						</View>
					</View>

					<View className="h-[1px] bg-[#1f1f26]" />

					<View className="flex-row justify-between items-center">
						<Text className="text-[#888] text-xs mt-0.5">Status</Text>
						<View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: STATUS_COLORS[screenStatus] + '22' }}>
							<View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[screenStatus] }} />
							<Text className="text-[13px] font-semibold" style={{ color: STATUS_COLORS[screenStatus] }}>
								{screenStatus === 'in_progress' ? 'In Progress' : screenStatus.charAt(0).toUpperCase() + screenStatus.slice(1)}
							</Text>
						</View>
					</View>
				</View>

				{/* ── GPS Broadcast Indicator ── */}
				{broadcasting && (
					<View className="flex-row items-center gap-2 bg-[#0d2a0d] rounded-xl p-3 border border-[#22c55e33]">
						<View className="w-2 h-2 rounded-full bg-[#22c55e]" />
						<Text className="text-[#22c55e] text-[13px] font-semibold">Broadcasting GPS to parents</Text>
					</View>
				)}

				{/* ── Action Buttons ── */}
				{screenStatus === 'assigned' && (
					<Pressable
						className={`bg-primary rounded-xl py-4 items-center ${actionLoading ? 'opacity-50' : ''}`}
						onPress={handleStartTrip}
						disabled={actionLoading}
					>
						{actionLoading
							? <ActivityIndicator color="#fff" />
							: <Text className="text-white text-base font-bold">▶  Start Trip</Text>
						}
					</Pressable>
				)}

				{screenStatus === 'in_progress' && (
					<>
						<Pressable
							className={`bg-[#1f1f26] rounded-xl py-4 items-center border border-[#2f2f38] ${actionLoading ? 'opacity-50' : ''}`}
							onPress={handleEndTrip}
							disabled={actionLoading}
						>
							{actionLoading
								? <ActivityIndicator color="#fff" />
								: <Text className="text-white text-base font-bold">⏹  End Trip</Text>
							}
						</Pressable>

						<Pressable className="bg-[#1a0000] rounded-xl py-[18px] items-center border-2 border-[#ff3b3b]" onPress={handleSOS}>
							<Text className="text-[#ff3b3b] text-base font-bold tracking-wide">⚠️  SOS EMERGENCY</Text>
						</Pressable>
					</>
				)}

				{screenStatus === 'completed' && (
					<View className="bg-[#0d1a0d] rounded-2xl p-7 items-center gap-2.5 border border-[#22c55e33]">
						<Text className="text-[40px]">✅</Text>
						<Text className="text-[#22c55e] text-xl font-bold">Trip Completed</Text>
						<Text className="text-[#888] text-sm text-center">Great work! Your trip has been recorded.</Text>
					</View>
				)}
			</>
		);
	};

	return (
		<View className="flex-1 bg-background">
			{/* ── Header ── */}
			<View className="flex-row justify-between items-center px-5 pt-14 pb-4 bg-background border-b border-[#1f1f26]">
				<Text className="text-primary text-xl font-bold">ShieldTrack</Text>
				<Pressable className="px-3.5 py-1.5 rounded-lg border border-[#2f2f38]" onPress={handleLogout}>
					<Text className="text-[#888] text-[13px] font-semibold">Logout</Text>
				</Pressable>
			</View>

			<ScrollView
				className="flex-1"
				contentContainerClassName="p-5 pb-10 gap-4"
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={handleRefresh}
						tintColor="#2574ff"
					/>
				}
			>
				{renderContent()}
			</ScrollView>
		</View>
	);
}
