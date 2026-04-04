import { useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Pressable,
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
			<View className="flex-1 bg-[#0f0000] pt-[60px] px-6">
				<View className="flex-1 items-center justify-center gap-3">
					<Text className="text-[56px]">✅</Text>
					<Text className="text-white text-2xl font-extrabold">SOS Sent</Text>
					<Text className="text-[#aaa] text-sm text-center max-w-[260px] leading-5">
						Emergency services and your admin have been alerted.
					</Text>
					{triggeredAt && (
						<Text className="text-[#666] text-[13px]">
							{new Date(triggeredAt).toLocaleTimeString()}
						</Text>
					)}
					<Text className="text-[#555] text-xs mt-2">Returning to trip screen...</Text>
				</View>
			</View>
		);
	}

	if (sosState === 'error') {
		return (
			<View className="flex-1 bg-[#0f0000] pt-[60px] px-6">
				<View className="flex-1 items-center justify-center gap-3">
					<Text className="text-[56px]">❌</Text>
					<Text className="text-white text-2xl font-extrabold">SOS Failed</Text>
					<Text className="text-[#aaa] text-sm text-center max-w-[260px] leading-5">{errorMsg}</Text>
					<Pressable className="bg-[#ff3b3b] rounded-xl px-7 py-3 mt-2" onPress={() => setSosState('idle')}>
						<Text className="text-white font-bold">Try Again</Text>
					</Pressable>
					<Pressable className="mt-1" onPress={() => router.back()}>
						<Text className="text-[#666] text-[13px]">Back to Trip</Text>
					</Pressable>
				</View>
			</View>
		);
	}

	return (
		<View className="flex-1 bg-[#0f0000] pt-[60px] px-6">
			{/* ── Warning Header ── */}
			<View className="items-center gap-2 mb-10">
				<Text className="text-[52px]">🚨</Text>
				<Text className="text-[#ff3b3b] text-[26px] font-extrabold tracking-widest">SOS EMERGENCY</Text>
				<Text className="text-[#ffaaaa] text-sm text-center leading-5 max-w-[280px] opacity-80">
					Send an emergency alert to the operations team and parents.
				</Text>
			</View>

			{/* ── Countdown Circle ── */}
			<View className="items-center gap-4 flex-1">
				<View className={`w-[120px] h-[120px] rounded-full border-[3px] items-center justify-center ${sosState === 'countdown' ? 'border-[#ff3b3b] bg-[#2a0000]' : 'bg-[#1a0000] border-[#ff3b3b44]'}`}>
					{sosState === 'sending' ? (
						<ActivityIndicator color="#ff3b3b" size="large" />
					) : (
						<Text className="text-[#ff3b3b] text-[52px] font-extrabold">
							{sosState === 'countdown' ? countdown : '!'}
						</Text>
					)}
				</View>

				{sosState === 'countdown' && (
					<Text className="text-[#ffaaaa] text-sm text-center max-w-[240px] leading-5">
						SOS sending in {countdown} second{countdown !== 1 ? 's' : ''}...
					</Text>
				)}
				{sosState === 'idle' && (
					<Text className="text-[#ffaaaa] text-sm text-center max-w-[240px] leading-5">
						Press CONFIRM to start a {COUNTDOWN_SECONDS}-second SOS countdown
					</Text>
				)}
				{sosState === 'sending' && (
					<Text className="text-[#ffaaaa] text-sm text-center max-w-[240px] leading-5">Sending SOS alert...</Text>
				)}
			</View>

			{/* ── Action Buttons ── */}
			<View className="gap-3 pb-12">
				{sosState === 'idle' && (
					<Pressable className="bg-[#ff3b3b] rounded-xl py-[18px] items-center" onPress={handleConfirm}>
						<Text className="text-white text-[17px] font-extrabold tracking-wide">⚠️  CONFIRM SOS</Text>
					</Pressable>
				)}

				<Pressable
					className={`bg-[#1a0000] rounded-xl py-3.5 items-center border border-[#ff3b3b44] ${sosState === 'sending' ? 'opacity-40' : ''}`}
					onPress={handleCancel}
					disabled={sosState === 'sending'}
				>
					<Text className="text-[#ff8888] text-[15px] font-semibold">
						{sosState === 'countdown' ? '✕  CANCEL' : '← Back'}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}
