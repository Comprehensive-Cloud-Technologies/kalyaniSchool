/**
 * notifications.js
 * ----------------
 * Utilities for Expo Push Notifications.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Alert } from 'react-native';
import { api } from './api';

// NOTE: setNotificationHandler is configured in App.js — not here.

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requests push-notification permission, obtains an Expo Push Token,
 * and saves it to the backend.
 *
 * Shows an Alert on the device with the exact result so failures are visible.
 *
 * @param {string} parentEmail
 * @returns {Promise<string|null>}
 */
export async function registerForPushNotificationsAsync(parentEmail) {
  // Must be a real device
  if (!Device.isDevice) {
    return null; // emulator — silently skip
  }

  if (!parentEmail) {
    return null;
  }

  try {
    // Create Android notification channel (required for Android 8+)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Tap-N-Eat Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10B981',
        sound: 'default',
      });
    }

    // Check / request permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      // Permission denied — show a one-time guide to the user
      Alert.alert(
        'Notifications Disabled',
        'To receive alerts for payments and RFID scans, please enable notifications for Tap-N-Eat in your device Settings → Apps → Tap-N-Eat → Notifications.',
        [{ text: 'OK' }]
      );
      return null;
    }

    // Get native FCM device token (works with Firebase Admin SDK / FCM V1)
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const token = tokenData?.data;

    if (!token) {
      Alert.alert('Notification Error', 'Could not obtain a push token. Please try again later.');
      return null;
    }

    // Save to backend
    await saveTokenToBackend(parentEmail, token);
    return token;

  } catch (err) {
    // Show the exact error on device so we can diagnose it
    const msg = err?.message || String(err);
    Alert.alert('Notification Setup Error', msg);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function saveTokenToBackend(parentEmail, pushToken) {
  try {
    const { ok, data } = await api('push-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: parentEmail, push_token: pushToken }),
    });
    if (!ok) {
      Alert.alert('Token Save Error', data?.message || 'Failed to save push token to server.');
    }
  } catch (err) {
    Alert.alert('Token Save Error', err?.message || 'Network error saving push token.');
  }
}

