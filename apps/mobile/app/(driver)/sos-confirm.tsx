import { useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

import { apiClient } from '../../lib/api';

type SosState = 'idle' | 'countdown' | 'sending' | 'sent' | 'error';

const COUNTDOWN_SECONDS = 3;

export default function SOSConfirmScreen() {
	const router = useRouter();
	const { trip_id, bus_id } = useLocalSearchParams<{ trip_id: string; bus_id: string }>();

	const [sosState, setSosState] = useState<SosState>('idle');
	const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [triggeredAt, setTriggeredAt] = useState<string | null>(null);

	const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// ─── Cleanup on unmount ────────────────────────────────────────────────────
	useEffect(() => {
		return () => {
			if (countdownRef.current) clearInterval(countdownRef.current);
		};
	}, []);

	// ─── Auto-navigate back after SOS sent ───────────────────────────────────
	useEffect(() => {
		if (sosState === 'sent') {
			const timer = setTimeout(() => {
				router.back();
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [sosState, router]);

	// ─── Start countdown and trigger SOS ──────────────────────────────────────
	const handleConfirm = async () => {
		if (sosState !== 'idle') return;

		// Heavy haptic feedback on confirmation tap
		await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
		setSosState('countdown');
		setCountdown(COUNTDOWN_SECONDS);

		let remaining = COUNTDOWN_SECONDS;
		countdownRef.current = setInterval(async () => {
			remaining -= 1;
			setCountdown(remaining);

			if (remaining <= 0) {
				clearInterval(countdownRef.current!);
				countdownRef.current = null;
				await triggerSOS();
			}
		}, 1000);
	};

	const triggerSOS = async () => {
		setSosState('sending');

		// Get current GPS position
		let lat = 0;
		let lng = 0;
		try {
			const location = await Location.getCurrentPositionAsync({
				accuracy: Location.Accuracy.High,
			});
			lat = location.coords.latitude;
			lng = location.coords.longitude;
		} catch {
			// If GPS fails, still send SOS with 0,0 location
			console.warn('[SOS] Could not get GPS location — sending with 0,0');
		}

		const result = await apiClient.triggerSos({
			trip_id: trip_id ?? '',
			bus_id: bus_id ?? '',
			lat,
			lng,
		});

		if (!result.ok) {
			setErrorMsg(result.error.error.message);
			setSosState('error');
			return;
		}

		// Success haptic
		await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
		setTriggeredAt(result.data.triggered_at);
		setSosState('sent');
	};

	const handleCancel = () => {
		if (sosState === 'countdown') {
			if (countdownRef.current) {
				clearInterval(countdownRef.current);
				countdownRef.current = null;
			}
			setSosState('idle');
			setCountdown(COUNTDOWN_SECONDS);
		} else {
			router.back();
		}
	};

	// ─── Render states ─────────────────────────────────────────────────────────
	if (sosState === 'sent') {
		return (
			<View style={styles.root}>
				<View style={styles.sentContainer}>
					<Text style={styles.sentIcon}>✅</Text>
					<Text style={styles.sentTitle}>SOS Sent</Text>
					<Text style={styles.sentSub}>
						Emergency services and your admin have been alerted.
					</Text>
					{triggeredAt && (
						<Text style={styles.sentTime}>
							{new Date(triggeredAt).toLocaleTimeString()}
						</Text>
					)}
					<Text style={styles.sentRedirect}>Returning to trip screen...</Text>
				</View>
			</View>
		);
	}

	if (sosState === 'error') {
		return (
			<View style={styles.root}>
				<View style={styles.sentContainer}>
					<Text style={styles.sentIcon}>❌</Text>
					<Text style={styles.sentTitle}>SOS Failed</Text>
					<Text style={styles.sentSub}>{errorMsg}</Text>
					<Pressable style={styles.retryButton} onPress={() => setSosState('idle')}>
						<Text style={styles.retryText}>Try Again</Text>
					</Pressable>
					<Pressable style={styles.cancelLink} onPress={() => router.back()}>
						<Text style={styles.cancelLinkText}>Back to Trip</Text>
					</Pressable>
				</View>
			</View>
		);
	}

	return (
		<View style={styles.root}>
			{/* ── Warning Header ── */}
			<View style={styles.header}>
				<Text style={styles.headerIcon}>🚨</Text>
				<Text style={styles.headerTitle}>SOS EMERGENCY</Text>
				<Text style={styles.headerSub}>
					Send an emergency alert to the operations team and parents.
				</Text>
			</View>

			{/* ── Countdown Circle ── */}
			<View style={styles.countdownContainer}>
				<View style={[
					styles.countdownCircle,
					sosState === 'countdown' && styles.countdownCircleActive,
				]}>
					{sosState === 'sending' ? (
						<ActivityIndicator color="#ff3b3b" size="large" />
					) : (
						<Text style={styles.countdownNumber}>
							{sosState === 'countdown' ? countdown : '!'}
						</Text>
					)}
				</View>

				{sosState === 'countdown' && (
					<Text style={styles.countdownLabel}>
						SOS sending in {countdown} second{countdown !== 1 ? 's' : ''}...
					</Text>
				)}
				{sosState === 'idle' && (
					<Text style={styles.countdownLabel}>
						Press CONFIRM to start a {COUNTDOWN_SECONDS}-second SOS countdown
					</Text>
				)}
				{sosState === 'sending' && (
					<Text style={styles.countdownLabel}>Sending SOS alert...</Text>
				)}
			</View>

			{/* ── Action Buttons ── */}
			<View style={styles.actions}>
				{sosState === 'idle' && (
					<Pressable style={styles.confirmButton} onPress={handleConfirm}>
						<Text style={styles.confirmButtonText}>⚠️  CONFIRM SOS</Text>
					</Pressable>
				)}

				<Pressable
					style={[styles.cancelButton, sosState === 'sending' && styles.buttonDisabled]}
					onPress={handleCancel}
					disabled={sosState === 'sending'}
				>
					<Text style={styles.cancelButtonText}>
						{sosState === 'countdown' ? '✕  CANCEL' : '← Back'}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#0f0000',
		paddingTop: 60,
		paddingHorizontal: 24,
	},
	// ── Header ──
	header: {
		alignItems: 'center',
		gap: 8,
		marginBottom: 40,
	},
	headerIcon: {
		fontSize: 52,
	},
	headerTitle: {
		color: '#ff3b3b',
		fontSize: 26,
		fontWeight: '800',
		letterSpacing: 1,
	},
	headerSub: {
		color: '#ffaaaa',
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 20,
		maxWidth: 280,
		opacity: 0.8,
	},
	// ── Countdown ──
	countdownContainer: {
		alignItems: 'center',
		gap: 16,
		flex: 1,
	},
	countdownCircle: {
		width: 120,
		height: 120,
		borderRadius: 60,
		backgroundColor: '#1a0000',
		borderWidth: 3,
		borderColor: '#ff3b3b44',
		alignItems: 'center',
		justifyContent: 'center',
	},
	countdownCircleActive: {
		borderColor: '#ff3b3b',
		backgroundColor: '#2a0000',
	},
	countdownNumber: {
		color: '#ff3b3b',
		fontSize: 52,
		fontWeight: '800',
	},
	countdownLabel: {
		color: '#ffaaaa',
		fontSize: 14,
		textAlign: 'center',
		maxWidth: 240,
		lineHeight: 20,
	},
	// ── Buttons ──
	actions: {
		gap: 12,
		paddingBottom: 48,
	},
	confirmButton: {
		backgroundColor: '#ff3b3b',
		borderRadius: 14,
		paddingVertical: 18,
		alignItems: 'center',
	},
	confirmButtonText: {
		color: '#ffffff',
		fontSize: 17,
		fontWeight: '800',
		letterSpacing: 0.5,
	},
	cancelButton: {
		backgroundColor: '#1a0000',
		borderRadius: 14,
		paddingVertical: 14,
		alignItems: 'center',
		borderWidth: 1,
		borderColor: '#ff3b3b44',
	},
	cancelButtonText: {
		color: '#ff8888',
		fontSize: 15,
		fontWeight: '600',
	},
	buttonDisabled: { opacity: 0.4 },
	// ── Sent / Error ──
	sentContainer: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 12,
	},
	sentIcon: { fontSize: 56 },
	sentTitle: {
		color: '#ffffff',
		fontSize: 24,
		fontWeight: '800',
	},
	sentSub: {
		color: '#aaa',
		fontSize: 14,
		textAlign: 'center',
		maxWidth: 260,
		lineHeight: 20,
	},
	sentTime: {
		color: '#666',
		fontSize: 13,
	},
	sentRedirect: {
		color: '#555',
		fontSize: 12,
		marginTop: 8,
	},
	retryButton: {
		backgroundColor: '#ff3b3b',
		borderRadius: 10,
		paddingHorizontal: 28,
		paddingVertical: 12,
		marginTop: 8,
	},
	retryText: {
		color: '#fff',
		fontWeight: '700',
	},
	cancelLink: { marginTop: 4 },
	cancelLinkText: {
		color: '#666',
		fontSize: 13,
	},
});
