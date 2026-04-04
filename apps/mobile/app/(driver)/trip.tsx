import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
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
				<View style={styles.centeredState}>
					<ActivityIndicator color="#2574ff" size="large" />
					<Text style={styles.stateText}>Loading assignment...</Text>
				</View>
			);
		}

		if (screenStatus === 'error') {
			return (
				<View style={styles.centeredState}>
					<Text style={styles.errorEmoji}>⚠️</Text>
					<Text style={styles.stateTitle}>Could not load assignment</Text>
					<Text style={styles.stateText}>{errorMsg}</Text>
					<Pressable style={styles.retryButton} onPress={loadAssignment}>
						<Text style={styles.retryButtonText}>Retry</Text>
					</Pressable>
				</View>
			);
		}

		if (screenStatus === 'no_assignment') {
			return (
				<View style={styles.centeredState}>
					<Text style={styles.errorEmoji}>📋</Text>
					<Text style={styles.stateTitle}>No Assignment Today</Text>
					<Text style={styles.stateText}>
						You have no trip assigned for today. Check back later or contact your admin.
					</Text>
				</View>
			);
		}

		if (!assignment) return null;

		return (
			<>
				{/* ── Assignment Card ── */}
				<View style={styles.card}>
					<Text style={styles.cardLabel}>Today's Assignment</Text>

					<View style={styles.cardRow}>
						<Text style={styles.cardIcon}>🚌</Text>
						<View>
							<Text style={styles.cardValueLarge}>{assignment.bus_plate}</Text>
							<Text style={styles.cardValueSmall}>Bus Plate</Text>
						</View>
					</View>

					<View style={styles.divider} />

					<View style={styles.cardRow}>
						<Text style={styles.cardIcon}>🗺️</Text>
						<View>
							<Text style={styles.cardValueLarge}>{assignment.route_name}</Text>
							<Text style={styles.cardValueSmall}>Route</Text>
						</View>
					</View>

					<View style={styles.divider} />

					<View style={styles.statusRow}>
						<Text style={styles.cardValueSmall}>Status</Text>
						<View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[screenStatus] + '22' }]}>
							<View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[screenStatus] }]} />
							<Text style={[styles.statusText, { color: STATUS_COLORS[screenStatus] }]}>
								{screenStatus === 'in_progress' ? 'In Progress' : screenStatus.charAt(0).toUpperCase() + screenStatus.slice(1)}
							</Text>
						</View>
					</View>
				</View>

				{/* ── GPS Broadcast Indicator ── */}
				{broadcasting && (
					<View style={styles.broadcastBanner}>
						<View style={styles.broadcastDot} />
						<Text style={styles.broadcastText}>Broadcasting GPS to parents</Text>
					</View>
				)}

				{/* ── Action Buttons ── */}
				{screenStatus === 'assigned' && (
					<Pressable
						style={[styles.primaryButton, actionLoading && styles.buttonDisabled]}
						onPress={handleStartTrip}
						disabled={actionLoading}
					>
						{actionLoading
							? <ActivityIndicator color="#fff" />
							: <Text style={styles.primaryButtonText}>▶  Start Trip</Text>
						}
					</Pressable>
				)}

				{screenStatus === 'in_progress' && (
					<>
						<Pressable
							style={[styles.endButton, actionLoading && styles.buttonDisabled]}
							onPress={handleEndTrip}
							disabled={actionLoading}
						>
							{actionLoading
								? <ActivityIndicator color="#fff" />
								: <Text style={styles.primaryButtonText}>⏹  End Trip</Text>
							}
						</Pressable>

						<Pressable style={styles.sosButton} onPress={handleSOS}>
							<Text style={styles.sosButtonText}>⚠️  SOS EMERGENCY</Text>
						</Pressable>
					</>
				)}

				{screenStatus === 'completed' && (
					<View style={styles.completedCard}>
						<Text style={styles.completedEmoji}>✅</Text>
						<Text style={styles.completedText}>Trip Completed</Text>
						<Text style={styles.completedSub}>Great work! Your trip has been recorded.</Text>
					</View>
				)}
			</>
		);
	};

	return (
		<View style={styles.root}>
			{/* ── Header ── */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>ShieldTrack</Text>
				<Pressable style={styles.logoutButton} onPress={handleLogout}>
					<Text style={styles.logoutText}>Logout</Text>
				</Pressable>
			</View>

			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
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

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#0c0c0f',
	},
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 20,
		paddingTop: 56,
		paddingBottom: 16,
		backgroundColor: '#0c0c0f',
		borderBottomWidth: 1,
		borderBottomColor: '#1f1f26',
	},
	headerTitle: {
		color: '#2574ff',
		fontSize: 20,
		fontWeight: '700',
	},
	logoutButton: {
		paddingHorizontal: 14,
		paddingVertical: 6,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: '#2f2f38',
	},
	logoutText: {
		color: '#888',
		fontSize: 13,
		fontWeight: '600',
	},
	scroll: { flex: 1 },
	scrollContent: {
		padding: 20,
		paddingBottom: 40,
		gap: 16,
	},
	// ── States ──
	centeredState: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 60,
		gap: 12,
	},
	errorEmoji: { fontSize: 48 },
	stateTitle: {
		color: '#ffffff',
		fontSize: 20,
		fontWeight: '700',
		textAlign: 'center',
	},
	stateText: {
		color: '#888',
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 20,
		maxWidth: 280,
	},
	retryButton: {
		marginTop: 8,
		backgroundColor: '#2574ff',
		paddingHorizontal: 24,
		paddingVertical: 10,
		borderRadius: 10,
	},
	retryButtonText: {
		color: '#fff',
		fontWeight: '600',
	},
	// ── Assignment Card ──
	card: {
		backgroundColor: '#15151a',
		borderRadius: 16,
		padding: 20,
		gap: 14,
	},
	cardLabel: {
		color: '#888',
		fontSize: 12,
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: 1,
	},
	cardRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
	},
	cardIcon: { fontSize: 28 },
	cardValueLarge: {
		color: '#ffffff',
		fontSize: 18,
		fontWeight: '700',
	},
	cardValueSmall: {
		color: '#888',
		fontSize: 12,
		marginTop: 2,
	},
	divider: {
		height: 1,
		backgroundColor: '#1f1f26',
	},
	statusRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	statusBadge: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 20,
	},
	statusDot: {
		width: 6,
		height: 6,
		borderRadius: 3,
	},
	statusText: {
		fontSize: 13,
		fontWeight: '600',
	},
	// ── GPS Banner ──
	broadcastBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: '#0d2a0d',
		borderRadius: 10,
		padding: 12,
		borderWidth: 1,
		borderColor: '#22c55e33',
	},
	broadcastDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: '#22c55e',
	},
	broadcastText: {
		color: '#22c55e',
		fontSize: 13,
		fontWeight: '600',
	},
	// ── Buttons ──
	primaryButton: {
		backgroundColor: '#2574ff',
		borderRadius: 14,
		paddingVertical: 16,
		alignItems: 'center',
	},
	endButton: {
		backgroundColor: '#1f1f26',
		borderRadius: 14,
		paddingVertical: 16,
		alignItems: 'center',
		borderWidth: 1,
		borderColor: '#2f2f38',
	},
	primaryButtonText: {
		color: '#ffffff',
		fontSize: 16,
		fontWeight: '700',
	},
	buttonDisabled: { opacity: 0.5 },
	sosButton: {
		backgroundColor: '#1a0000',
		borderRadius: 14,
		paddingVertical: 18,
		alignItems: 'center',
		borderWidth: 2,
		borderColor: '#ff3b3b',
	},
	sosButtonText: {
		color: '#ff3b3b',
		fontSize: 16,
		fontWeight: '800',
		letterSpacing: 0.5,
	},
	// ── Completed ──
	completedCard: {
		backgroundColor: '#0d1a0d',
		borderRadius: 16,
		padding: 28,
		alignItems: 'center',
		gap: 10,
		borderWidth: 1,
		borderColor: '#22c55e33',
	},
	completedEmoji: { fontSize: 40 },
	completedText: {
		color: '#22c55e',
		fontSize: 20,
		fontWeight: '700',
	},
	completedSub: {
		color: '#888',
		fontSize: 14,
		textAlign: 'center',
	},
});
