import { StyleSheet, Text, View } from 'react-native';

export default function NotificationsScreen() {
	return (
		<View style={styles.container}>
			<Text style={styles.title}>Notifications</Text>
			<Text style={styles.subtitle}>SOS and Deviation alerts hit here.</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		padding: 24,
		justifyContent: 'center',
		backgroundColor: '#0c0c0f',
	},
	title: {
		fontSize: 28,
		fontWeight: '700',
		color: '#ffffff',
	},
	subtitle: {
		opacity: 0.8,
		marginTop: 8,
		color: '#ffffff',
	},
});
