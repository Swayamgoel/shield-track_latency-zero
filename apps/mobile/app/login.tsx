import { useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	Text,
	TextInput,
	View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

import { apiClient } from '../lib/api';
import { saveSession } from '../lib/session';

const DRIVER_DEVICE_KEY = 'shieldtrack.driver.device_id.v1';

const getDeviceId = async (): Promise<string | undefined> => {
	try {
		const existingId = await AsyncStorage.getItem(DRIVER_DEVICE_KEY);
		if (existingId) return existingId;

		const platformPrefix = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'device';
		const generatedId = `${platformPrefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
		await AsyncStorage.setItem(DRIVER_DEVICE_KEY, generatedId);
		return generatedId;
	} catch {
		return undefined;
	}
};

export default function LoginScreen() {
	const router = useRouter();
	const [mode, setMode] = useState<'driver' | 'parent'>('driver');
	
	// Driver fields
	const [email, setEmail] = useState('');
	const [driverInstituteCode, setDriverInstituteCode] = useState('');
	
	// Parent fields
	const [instituteCode, setInstituteCode] = useState('');
	const [registrationNo, setRegistrationNo] = useState('');
	
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const canSubmitDriver = email.trim().length > 0 && driverInstituteCode.trim().length > 0;
	const canSubmitParent = instituteCode.trim().length > 0 && registrationNo.trim().length > 0;
	const canSubmit = mode === 'driver' ? canSubmitDriver : canSubmitParent;

	const handleLogin = async () => {
		if (!canSubmit || submitting) return;
		setSubmitting(true);
		setError(null);

		const deviceId = mode === 'driver' ? await getDeviceId() : undefined;
		if (mode === 'driver' && !deviceId) {
			setError('Unable to read device identity. Please retry on a physical device.');
			setSubmitting(false);
			return;
		}

		const result = mode === 'driver'
			? await apiClient.login({
					email: email.trim(),
					institute_code: driverInstituteCode.trim(),
					device_id: deviceId!,
			  })
			: await apiClient.parentLogin({
					institute_code: instituteCode.trim(),
					registration_no: registrationNo.trim(),
			  });

		if (!result.ok) {
			setError(result.error.error.message || 'Login failed');
			setSubmitting(false);
			return;
		}

		await saveSession(result.data.session);
		setSubmitting(false);
		
		if (result.data.session.role === 'parent') {
			router.replace('/tracker');
		} else {
			router.replace('/trip');
		}
	};

	return (
		<KeyboardAvoidingView
			{...(Platform.OS === 'ios' ? { behavior: 'padding' } : {})}
			className="flex-1 justify-center p-6 bg-background"
		>
			<View className="bg-card rounded-2xl p-6 gap-3">
				<View className="flex-row bg-muted rounded-lg p-1 mb-2">
					<Pressable
						className={`flex-1 py-2 items-center rounded-md ${mode === 'driver' ? 'bg-primary' : ''}`}
						onPress={() => { setMode('driver'); setError(null); }}
					>
						<Text className={`font-semibold ${mode === 'driver' ? 'text-white' : 'text-[#888]'}`}>Driver</Text>
					</Pressable>
					<Pressable
						className={`flex-1 py-2 items-center rounded-md ${mode === 'parent' ? 'bg-primary' : ''}`}
						onPress={() => { setMode('parent'); setError(null); }}
					>
						<Text className={`font-semibold ${mode === 'parent' ? 'text-white' : 'text-[#888]'}`}>Parent</Text>
					</Pressable>
				</View>

				<Text className="text-[28px] font-bold text-white">
					{mode === 'driver' ? 'Driver Login' : 'Parent Login'}
				</Text>
				<Text className="opacity-80 mb-2 text-white">
					{mode === 'driver' ? 'Sign in to start your route' : 'Track your student\'s bus'}
				</Text>

				{mode === 'driver' ? (
					<>
						<TextInput
							placeholder="Email"
							placeholderTextColor="#888"
							autoCapitalize="none"
							autoComplete="email"
							keyboardType="email-address"
							value={email}
							onChangeText={setEmail}
							className="bg-muted text-white rounded-xl px-[14px] py-3"
							editable={!submitting}
						/>
						<TextInput
							placeholder="Institute Code"
							placeholderTextColor="#888"
							autoCapitalize="characters"
							value={driverInstituteCode}
							onChangeText={setDriverInstituteCode}
							className="bg-muted text-white rounded-xl px-[14px] py-3"
							editable={!submitting}
						/>
					</>
				) : (
					<>
						<TextInput
							placeholder="Institute Code"
							placeholderTextColor="#888"
							autoCapitalize="characters"
							value={instituteCode}
							onChangeText={setInstituteCode}
							className="bg-muted text-white rounded-xl px-[14px] py-3"
							editable={!submitting}
						/>
						<TextInput
							placeholder="Registration No."
							placeholderTextColor="#888"
							autoCapitalize="characters"
							value={registrationNo}
							onChangeText={setRegistrationNo}
							className="bg-muted text-white rounded-xl px-[14px] py-3"
							editable={!submitting}
						/>
					</>
				)}

				{error ? <Text className="text-error text-white">{error}</Text> : null}

				<Pressable
					className={`bg-primary rounded-xl py-3 items-center mt-2 ${(!canSubmit || submitting) ? 'opacity-50' : ''}`}
					onPress={handleLogin}
					disabled={!!(!canSubmit || submitting)}
				>
					{submitting ? (
						<ActivityIndicator color="#ffffff" />
					) : (
						<Text className="text-white font-semibold">Sign In</Text>
					)}
				</Pressable>

				<Text className="opacity-60 text-xs mt-2 text-white">
					Tip: set EXPO_PUBLIC_USE_MOCKS=1 to test without backend.
				</Text>
			</View>
		</KeyboardAvoidingView>
	);
}
