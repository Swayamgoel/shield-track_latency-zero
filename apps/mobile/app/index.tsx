import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
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
			<View className="flex-1 items-center justify-center bg-background">
				<Text className="text-primary text-base font-semibold">Booting ShieldTrack...</Text>
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
