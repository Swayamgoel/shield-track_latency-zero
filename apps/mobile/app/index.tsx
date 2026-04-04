import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';

import { loadSession } from '../lib/session';

export default function IndexScreen() {
	const [loading, setLoading] = useState(true);
	const [role, setRole] = useState<'driver' | 'parent' | null>(null);

	useEffect(() => {
		loadSession()
			.then((session) => {
				if (session) {
					setRole(session.role);
				}
				setLoading(false);
			})
			.catch(() => {
				setLoading(false);
			});
	}, []);

	if (loading) {
		return (
			<View style={styles.container}>
				<Text style={styles.text}>Booting ShieldTrack...</Text>
			</View>
		);
	}

	if (role === 'driver') {
		return <Redirect href="/trip" />;
	} else if (role === 'parent') {
		return <Redirect href="/tracker" />;
	} else {
		return <Redirect href="/login" />;
	}
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		backgroundColor: '#0c0c0f',
	},
	text: {
		color: '#2574ff',
		fontSize: 16,
		fontWeight: '600',
	},
});
