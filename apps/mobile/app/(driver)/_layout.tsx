import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
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
			<View className="flex-1 items-center justify-center bg-background">
				<Text className="text-primary text-base font-semibold">Loading Driver Stack...</Text>
			</View>
		);
	}

	if (!allowed) {
		return <Redirect href="/login" />;
	}

	return <Slot />;
}
