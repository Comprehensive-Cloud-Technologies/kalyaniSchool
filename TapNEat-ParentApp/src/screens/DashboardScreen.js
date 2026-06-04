/**
 * DashboardScreen.js
 * ------------------
 * Root screen shown after login. Renders the top header bar (school logo,
 * school name, parent avatar) and houses the bottom tab navigator that
 * switches between the four main feature tabs.
 */

// ── React & React-Native ──────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Modal,
} from 'react-native';

// ── Navigation & Icons ────────────────────────────────────────────────────────
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// ── Utilities & Constants ─────────────────────────────────────────────────────
import { api } from '../utils/api';
import { getParentAuth, clearParentAuth, setItem } from '../utils/storage';
import { COLORS } from '../constants';
import { registerForPushNotificationsAsync } from '../utils/notifications';

// ── Tab Screens ───────────────────────────────────────────────────────────────
import WalletTab            from './WalletTab';
import SubscriptionsTab     from './SubscriptionsTab';
import TransactionHistoryTab from './TransactionHistoryTab';
import CanteenHistoryTab    from './CanteenHistoryTab';

// ─────────────────────────────────────────────────────────────────────────────
const Tab = createBottomTabNavigator();

/**
 * Converts a relative logo path (e.g. "/uploads/logos/school_1.jpg") into a
 * full absolute URL.
 *
 * NOTE: The HTTP nginx config only proxies /api/ — /uploads/ is only available
 * on the HTTPS domain. Always use the HTTPS base for logo URLs.
 */
function resolveLogoUrl(relativePath) {
  if (!relativePath) return '';
  if (/^https?:\/\//i.test(relativePath)) return relativePath; // already absolute
  return `https://13-51-167-146.sslip.io${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardScreen({ navigation }) {
  // Respect the device's native navigation bar height so our tab bar never
  // hides behind the phone's gesture / button bar.
  const insets = useSafeAreaInsets();

  // ── State ──────────────────────────────────────────────────────────────────
  const [parentEmail,   setParentEmail]   = useState('');
  const [parentName,    setParentName]    = useState('Parent');
  const [schoolLogoUrl, setSchoolLogoUrl] = useState('');
  const [schoolName,    setSchoolName]    = useState('');
  const [modalVisible,  setModalVisible]  = useState(false); // Profile popup
  const [logoError,     setLogoError]     = useState(false); // Image load failure flag

  // Reset the failure flag whenever the logo URL changes so the <Image> retries
  useEffect(() => { setLogoError(false); }, [schoolLogoUrl]);

  // ── On mount: load stored session then refresh logo from server ────────────
  useEffect(() => {
    getParentAuth().then(async ({ email, name, schoolLogoUrl: cachedLogo, schoolName: sname }) => {
      // If no email is stored, the user is not logged in — go back to login
      if (!email) {
        navigation.replace('SchoolCode');
        return;
      }

      // Apply cached values immediately for a fast first render
      setParentEmail(email);
      setParentName(name);
      setSchoolLogoUrl(cachedLogo || '');
      setSchoolName(sname || '');

      // Register for push notifications now that we have the parent's email.
      // Runs every mount so a token is always fresh (no-op if already saved).
      registerForPushNotificationsAsync(email).catch((err) => {
        console.error('[Dashboard] Push notification registration error:', err);
      });

      // Then fetch the latest profile from the server so the logo is always fresh
      // (e.g. the school may have updated its logo after the user last logged in)
      try {
        const { ok, data } = await api(`parent-portal?action=profile&email=${encodeURIComponent(email)}`);
        if (ok && data.school && data.school.logo_url) {
          const freshLogo = data.school.logo_url;
          setSchoolLogoUrl(freshLogo);
          setItem('parentSchoolLogoUrl', freshLogo); // keep cache in sync
        }
      } catch (_) {
        // Non-fatal — continue showing the cached logo (or the initial letter)
      }
    });
  }, []);

  // ── Logout handler ─────────────────────────────────────────────────────────
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await clearParentAuth();
          navigation.replace('SchoolCode');
        },
      },
    ]);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>

      {/* ── Top Header ──────────────────────────────────────────────────── */}
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerContent}>

          {/* Left side: school logo + school name */}
          <View style={styles.headerLeft}>
            <View style={styles.logoCircle}>
              {schoolLogoUrl && !logoError ? (
                // Show school logo image; fall back to initial on error
                <Image
                  source={{ uri: resolveLogoUrl(schoolLogoUrl) }}
                  style={styles.logoImage}
                  resizeMode="contain"
                  onError={() => setLogoError(true)}
                />
              ) : (
                // Fallback: first letter of the school name
                <Text style={styles.logoInitial}>
                  {(schoolName || 'T').slice(0, 1).toUpperCase()}
                </Text>
              )}
            </View>
            <View>
              <Text style={styles.headerTitle} numberOfLines={2}>
                {schoolName || 'Tap-N-Eat'}
              </Text>
              <Text style={styles.headerSub}>Parent Portal</Text>
            </View>
          </View>

          {/* Right side: parent avatar (tappable — opens profile modal) */}
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => setModalVisible(true)} activeOpacity={0.7}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {(parentName || 'P').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Decorative accent line below the header */}
        <View style={styles.headerAccent} />
      </SafeAreaView>

      {/* ── Profile Modal ───────────────────────────────────────────────── */}
      {/* Appears when the parent taps their avatar. Shows name, email, and
          a Logout button. Tapping outside the card dismisses the modal. */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        {/* Semi-transparent backdrop — tap it to close */}
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          {/* Card content — inner TouchableOpacity prevents tap-through */}
          <TouchableOpacity activeOpacity={1} style={styles.profileCard}>
            {/* Large avatar circle */}
            <View style={styles.profileAvatarLarge}>
              <Text style={styles.profileAvatarTextLarge}>
                {(parentName || 'P').slice(0, 1).toUpperCase()}
              </Text>
            </View>

            <Text style={styles.profileName}>{parentName}</Text>
            <Text style={styles.profileEmail}>{parentEmail}</Text>

            <View style={styles.modalDivider} />

            {/* Re-register push notifications */}
            <TouchableOpacity
              style={[styles.modalLogoutBtn, { borderColor: COLORS.primary, marginBottom: 10 }]}
              onPress={async () => {
                setModalVisible(false);
                await registerForPushNotificationsAsync(parentEmail);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="notifications-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={[styles.modalLogoutText, { color: COLORS.primary }]}>Enable Notifications</Text>
            </TouchableOpacity>

            {/* Logout button */}
            <TouchableOpacity
              style={styles.modalLogoutBtn}
              onPress={() => { setModalVisible(false); handleLogout(); }}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={20} color={COLORS.danger} style={{ marginRight: 8 }} />
              <Text style={styles.modalLogoutText}>Logout</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Bottom Tab Navigator ─────────────────────────────────────────── */}
      {/* Four tabs: Home (Wallet), Meal Plans, Canteen, Payments (History).
          Tab bar height accounts for the device's bottom inset so it never
          overlaps the phone's native navigation bar. */}
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor:   COLORS.primary,
          tabBarInactiveTintColor: '#64748B',
          tabBarStyle: {
            backgroundColor: '#ffffff',
            borderTopWidth:  0,
            paddingBottom:   Math.max(insets.bottom, 12), // respect device nav bar
            paddingTop:      12,
            height:          60 + Math.max(insets.bottom, 12),
            shadowColor:     '#64748B',
            shadowOffset:    { width: 0, height: -10 },
            shadowOpacity:   0.06,
            shadowRadius:    20,
            elevation:       16,
          },
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600', marginTop: 4 },
          // Vector icon that switches between filled / outline variants on focus
          tabBarIcon: ({ color, focused }) => {
            const icons = {
              Wallet:    focused ? 'wallet'     : 'wallet-outline',
              MealPlans: focused ? 'restaurant' : 'restaurant-outline',
              Canteen:   focused ? 'fast-food'  : 'fast-food-outline',
              History:   focused ? 'receipt'    : 'receipt-outline',
            };
            return <Ionicons name={icons[route.name]} size={24} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Wallet"    options={{ tabBarLabel: 'Home' }}>
          {() => <WalletTab parentEmail={parentEmail} parentName={parentName} />}
        </Tab.Screen>

        <Tab.Screen name="MealPlans" options={{ tabBarLabel: 'Meal Plans' }}>
          {() => <SubscriptionsTab parentEmail={parentEmail} />}
        </Tab.Screen>

        <Tab.Screen name="Canteen"   options={{ tabBarLabel: 'Canteen' }}>
          {() => <CanteenHistoryTab parentEmail={parentEmail} />}
        </Tab.Screen>

        <Tab.Screen name="History"   options={{ tabBarLabel: 'Payments' }}>
          {() => <TransactionHistoryTab parentEmail={parentEmail} />}
        </Tab.Screen>
      </Tab.Navigator>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Root container — dark sidebar colour fills the status-bar area
  root: { flex: 1, backgroundColor: COLORS.sidebar },

  // Header bar background
  header:        { backgroundColor: COLORS.sidebar },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, flexShrink: 1, marginRight: 10 },
  headerRight:   { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' },

  // School logo circle (shows image or initial letter)
  logoCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },
  logoImage:   { width: 44, height: 44, borderRadius: 22 },
  logoInitial: { color: '#ffffff', fontWeight: '800', fontSize: 20 },

  // School name & sub-label
  headerTitle: { color: '#ffffff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3, flexShrink: 1, flexWrap: 'wrap' },
  headerSub:   { color: COLORS.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2 },

  // Parent avatar button (top-right)
  avatarCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  avatarText:   { color: '#ffffff', fontWeight: '800', fontSize: 16 },

  // Green accent line under the header
  headerAccent: { height: 3, backgroundColor: COLORS.primary },

  // ── Profile modal ─────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  profileCard:  { backgroundColor: '#ffffff', borderRadius: 24, padding: 32, alignItems: 'center', width: '100%', maxWidth: 340, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.1, shadowRadius: 24, elevation: 10 },

  profileAvatarLarge:     { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 3, borderColor: '#ffffff', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  profileAvatarTextLarge: { color: COLORS.primaryDark, fontSize: 36, fontWeight: '800' },
  profileName:            { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 4, textAlign: 'center' },
  profileEmail:           { fontSize: 14, color: COLORS.textMuted, marginBottom: 24, textAlign: 'center' },

  modalDivider:    { width: '100%', height: 1, backgroundColor: COLORS.border, marginBottom: 24 },
  modalLogoutBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.dangerLight, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 16, width: '100%' },
  modalLogoutText: { color: COLORS.danger, fontSize: 16, fontWeight: '700' },
});
