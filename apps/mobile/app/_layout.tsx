import '../lib/locationTask'; // Register GPS background task on app start
import { Slot } from 'expo-router';
import { StyleSheet, View } from 'react-native';

export default function RootLayout() {
	// Expo Router uses app/index.tsx for initial authentication booting.
	// The root layout simply provides the absolute entry frame.
	return (
		<View style={styles.container}>
			<Slot />
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#0c0c0f',
	},
});
