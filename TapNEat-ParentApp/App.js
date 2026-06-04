import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import SchoolCodeScreen from './src/screens/SchoolCodeScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';

// ── Foreground notification display ──────────────────────────────────────────
// Show banner + play sound even when the app is already open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─────────────────────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator();

/**
 * Navigation ref exported so notification handlers (outside the React tree)
 * can trigger programmatic navigation.
 */
export const navigationRef = React.createRef();

/**
 * Maps the notification data.screen value to the bottom-tab screen name
 * used inside DashboardScreen's Tab.Navigator.
 */
const SCREEN_TO_TAB = {
  PaymentHistory: 'History',
  CanteenHistory: 'Canteen',
};

/**
 * Navigate to the correct tab based on the notification data payload.
 * Works whether the app is foregrounded, backgrounded, or was killed.
 */
function handleNotificationNavigation(data) {
  if (!data || !navigationRef.current) return;
  const tabName = SCREEN_TO_TAB[data.screen];
  if (!tabName) return;
  // Navigate to the Dashboard stack screen and activate the specified tab
  navigationRef.current.navigate('Dashboard', { screen: tabName });
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const notifListener    = useRef();
  const responseListener = useRef();

  useEffect(() => {
    // (A) Notification arrives while app is OPEN — banner shown automatically
    notifListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {
        // No extra action; the banner is displayed by setNotificationHandler
      }
    );

    // (B) User TAPS a notification (app was foreground or background)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        handleNotificationNavigation(data);
      }
    );

    // (C) App was KILLED and re-opened via a notification tap
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response?.notification?.request?.content?.data) {
        // Delay so the navigator is mounted and ready before we navigate
        setTimeout(() => {
          handleNotificationNavigation(
            response.notification.request.content.data
          );
        }, 1000);
      }
    });

    return () => {
      Notifications.removeNotificationSubscription(notifListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName="SchoolCode"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="SchoolCode" component={SchoolCodeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
