import { Redirect } from 'expo-router';

// Alerts are now embedded inside the tracker screen's custom tab bar.
// This redirect ensures any direct navigation to /notifications still works.
export default function NotificationsScreen() {
	return <Redirect href="/tracker" />;
}
