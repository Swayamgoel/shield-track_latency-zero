import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, Slot } from 'expo-router';

import { loadSession } from '../../lib/session';

export default function DriverLayout() {
	const [allowed, setAllowed] = useState<boolean | null>(null);

	useEffect(() => {
		let mounted = true;
		loadSession()
			.then((session) => {
				if (!mounted) return;
				setAllowed(Boolean(session && session.role === 'driver'));
			})
			.catch(() => {
				if (!mounted) return;
				setAllowed(false);
			});

		return () => {
			mounted = false;
		};
	}, []);

	if (allowed === null) {
		return (
			<View style={styles.loading}>
				<Text style={styles.loadingText}>Loading Driver Stack...</Text>
			</View>
		);
	}

	if (!allowed) {
		return <Redirect href="/login" />;
	}

	return <Slot />;
}

const styles = StyleSheet.create({
	loading: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: '#0c0c0f',
	},
	loadingText: {
		color: '#2574ff',
		fontSize: 16,
		fontWeight: '600',
	},
});
