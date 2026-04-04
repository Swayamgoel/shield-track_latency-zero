import '../global.css';
import '../lib/locationTask'; // Register GPS background task on app start
import { Slot } from 'expo-router';
import { View } from 'react-native';

export default function RootLayout() {
	// Expo Router uses app/index.tsx for initial authentication booting.
	// The root layout simply provides the absolute entry frame.
	return (
		<View className="flex-1 bg-background">
			<Slot />
		</View>
	);
}
