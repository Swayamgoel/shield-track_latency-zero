import { useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { apiClient } from '../lib/api';
import { saveSession } from '../lib/session';

const getDeviceId = (): string | undefined => {
	// TODO: Plug in a device ID source when available.
	return undefined;
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

		const result = mode === 'driver'
			? await apiClient.login({
					email: email.trim(),
					institute_code: driverInstituteCode.trim(),
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
			style={styles.container}
		>
			<View style={styles.card}>
				<View style={styles.toggleContainer}>
					<Pressable
						style={[styles.toggleButton, mode === 'driver' ? styles.toggleButtonActive : null]}
						onPress={() => { setMode('driver'); setError(null); }}
					>
						<Text style={[styles.toggleText, mode === 'driver' ? styles.toggleTextActive : null]}>Driver</Text>
					</Pressable>
					<Pressable
						style={[styles.toggleButton, mode === 'parent' ? styles.toggleButtonActive : null]}
						onPress={() => { setMode('parent'); setError(null); }}
					>
						<Text style={[styles.toggleText, mode === 'parent' ? styles.toggleTextActive : null]}>Parent</Text>
					</Pressable>
				</View>

				<Text style={[styles.title, styles.text]}>
					{mode === 'driver' ? 'Driver Login' : 'Parent Login'}
				</Text>
				<Text style={[styles.subtitle, styles.text]}>
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
							style={styles.input}
							editable={!submitting}
						/>
						<TextInput
							placeholder="Institute Code"
							placeholderTextColor="#888"
							autoCapitalize="characters"
							value={driverInstituteCode}
							onChangeText={setDriverInstituteCode}
							style={styles.input}
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
							style={styles.input}
							editable={!submitting}
						/>
						<TextInput
							placeholder="Registration No."
							placeholderTextColor="#888"
							autoCapitalize="characters"
							value={registrationNo}
							onChangeText={setRegistrationNo}
							style={styles.input}
							editable={!submitting}
						/>
					</>
				)}

				{error ? <Text style={[styles.error, styles.text]}>{error}</Text> : null}

				<Pressable
					style={[styles.button, (!canSubmit || submitting) ? styles.buttonDisabled : null]}
					onPress={handleLogin}
					disabled={!!(!canSubmit || submitting)}
				>
					{submitting ? (
						<ActivityIndicator color="#ffffff" />
					) : (
						<Text style={styles.buttonText}>Sign In</Text>
					)}
				</Pressable>

				<Text style={[styles.helper, styles.text]}>
					Tip: set EXPO_PUBLIC_USE_MOCKS=1 to test without backend.
				</Text>
			</View>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: 'center',
		padding: 24,
		backgroundColor: '#0c0c0f',
	},
	card: {
		backgroundColor: '#15151a',
		borderRadius: 16,
		padding: 24,
		gap: 12,
	},
	toggleContainer: {
		flexDirection: 'row',
		backgroundColor: '#1f1f26',
		borderRadius: 8,
		padding: 4,
		marginBottom: 8,
	},
	toggleButton: {
		flex: 1,
		paddingVertical: 8,
		alignItems: 'center',
		borderRadius: 6,
	},
	toggleButtonActive: {
		backgroundColor: '#2574ff',
	},
	toggleText: {
		color: '#888',
		fontWeight: '600',
	},
	toggleTextActive: {
		color: '#ffffff',
	},
	title: {
		fontSize: 28,
		fontWeight: '700',
	},
	subtitle: {
		opacity: 0.8,
		marginBottom: 8,
	},
	text: {
		color: '#ffffff',
	},
	input: {
		backgroundColor: '#1f1f26',
		borderRadius: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		color: '#ffffff',
	},
	error: {
		color: '#ff6b6b',
	},
	button: {
		backgroundColor: '#2574ff',
		borderRadius: 10,
		paddingVertical: 12,
		alignItems: 'center',
		marginTop: 8,
	},
	buttonDisabled: {
		opacity: 0.5,
	},
	buttonText: {
		color: '#ffffff',
		fontWeight: '600',
	},
	helper: {
		opacity: 0.6,
		fontSize: 12,
		marginTop: 8,
	},
});
