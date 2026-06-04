import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../utils/api';
import { setParentAuth, getItem } from '../utils/storage';
import { COLORS } from '../constants';
import { registerForPushNotificationsAsync } from '../utils/notifications';

const PRIVACY_POLICY_URL = 'https://tapneat.cctindia.in/privacy-policy.html';

export default function LoginScreen({ navigation, route }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [schoolName, setSchoolName] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [schoolCode, setSchoolCode] = useState('');

  useEffect(() => {
    const info = route?.params?.schoolInfo || null;
    if (info) {
      setSchoolName(info.name || '');
      setSchoolId(info.id ? String(info.id) : '');
      setSchoolCode(info.school_code || info.code || '');
    }
    getItem('parentSchoolName').then((v) => setSchoolName((prev) => prev || v || ''));
    getItem('parentSchoolId').then((v) => setSchoolId((prev) => prev || v || ''));
    getItem('parentSchoolCode').then((v) => setSchoolCode((prev) => prev || v || ''));
  }, [route?.params]);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Signup state
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPhone, setSuPhone] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [suError, setSuError] = useState('');
  const [suLoading, setSuLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError('Please enter email and password'); return; }
    setLoading(true); setError('');
    const { ok, data } = await api('parent-portal?action=login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password, school_id: schoolId || undefined, school_code: schoolCode || undefined }),
    });
    if (!ok) { setError(data.error || 'Login failed'); setLoading(false); return; }
    const logoUrl  = (data.data.school && data.data.school.logo_url) || '';
    const sName    = (data.data.school && data.data.school.name) || '';
    await setParentAuth(data.data.parent.email, data.data.parent.full_name, logoUrl, sName, schoolId);
    // Register push token right after login — we have a confirmed email here
    registerForPushNotificationsAsync(data.data.parent.email).catch((err) => {
      console.error('[Login] Push registration error:', err);
    });
    setLoading(false);
    navigation.replace('Dashboard');
  };

  const handleSignup = async () => {
    if (!suName.trim() || !suEmail.trim() || !suPassword) { setSuError('Name, email and password are required'); return; }
    if (suPassword !== suConfirm) { setSuError('Passwords do not match'); return; }
    if (suPassword.length < 6) { setSuError('Password must be at least 6 characters'); return; }
    setSuLoading(true); setSuError('');
    const { ok, data } = await api('parent-portal?action=signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: suName.trim(), email: suEmail.trim(), phone: suPhone.trim(), password: suPassword, school_id: schoolId || undefined, school_code: schoolCode || undefined }),
    });
    if (!ok) { setSuError(data.error || 'Signup failed'); setSuLoading(false); return; }
    const logoUrl = (data.data.school && data.data.school.logo_url) || '';
    const sName   = (data.data.school && data.data.school.name) || '';
    await setParentAuth(data.data.parent.email, data.data.parent.full_name, logoUrl, sName, schoolId);
    setSuLoading(false);
    navigation.replace('Dashboard');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
        >

          {/* Header */}
          <View style={styles.headerSection}>
            <Image source={require('../../assets/cct-logo.png')} style={styles.logoImage} resizeMode="contain" />
            <View style={styles.badgeWrap}>
              <Text style={styles.badge}>{schoolName || 'Parent Portal'}</Text>
            </View>
            <Text style={styles.title}>{mode === 'login' ? 'Parent Access' : 'Create Account'}</Text>
            <Text style={styles.subtitle}>
              {mode === 'login'
                ? 'Track your child wallet, view transactions, and recharge anytime.'
                : 'Register to manage your child\'s meals and wallet.'}
            </Text>
          </View>

          {/* Mode toggle */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'login' && styles.toggleBtnActive]}
              onPress={() => { setMode('login'); setError(''); setSuError(''); }}
            >
              <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'signup' && styles.toggleBtnActive]}
              onPress={() => { setMode('signup'); setError(''); setSuError(''); }}
            >
              <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {mode === 'login' ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput style={styles.input} value={email} onChangeText={setEmail}
                  placeholder="parent@example.com" placeholderTextColor={COLORS.textLight}
                  keyboardType="email-address" autoCapitalize="none" editable={!loading} />
                <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
                <TextInput style={styles.input} value={password} onChangeText={setPassword}
                  placeholder="Enter password" placeholderTextColor={COLORS.textLight}
                  secureTextEntry editable={!loading} onSubmitEditing={handleLogin} returnKeyType="done" />
                {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
                <TouchableOpacity style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
                  onPress={handleLogin} disabled={loading} activeOpacity={0.8}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Sign in to Parent Portal</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput style={styles.input} value={suName} onChangeText={setSuName}
                  placeholder="Your full name" placeholderTextColor={COLORS.textLight} editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Email *</Text>
                <TextInput style={styles.input} value={suEmail} onChangeText={setSuEmail}
                  placeholder="parent@example.com" placeholderTextColor={COLORS.textLight}
                  keyboardType="email-address" autoCapitalize="none" editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Phone (optional)</Text>
                <TextInput style={styles.input} value={suPhone} onChangeText={setSuPhone}
                  placeholder="+91 98765 43210" placeholderTextColor={COLORS.textLight}
                  keyboardType="phone-pad" editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Password *</Text>
                <TextInput style={styles.input} value={suPassword} onChangeText={setSuPassword}
                  placeholder="Min 6 characters" placeholderTextColor={COLORS.textLight}
                  secureTextEntry editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Confirm Password *</Text>
                <TextInput style={styles.input} value={suConfirm} onChangeText={setSuConfirm}
                  placeholder="Repeat password" placeholderTextColor={COLORS.textLight}
                  secureTextEntry editable={!suLoading} onSubmitEditing={handleSignup} returnKeyType="done" />
                {!!suError && <View style={styles.errorBox}><Text style={styles.errorText}>{suError}</Text></View>}
                <TouchableOpacity style={[styles.loginBtn, suLoading && styles.loginBtnDisabled]}
                  onPress={handleSignup} disabled={suLoading} activeOpacity={0.8}>
                  {suLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Create Account</Text>}
                </TouchableOpacity>
                <Text style={styles.signupNote}>
                  After signing up, ask your school to link your children using this email address.
                </Text>
              </>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footerSection}>
            <Text style={styles.footerPowered}>Powered by Comprehensive Cloud Technologies Pvt Ltd</Text>
            <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} activeOpacity={0.7}>
              <Text style={styles.privacyLink}>Privacy Policy & Terms</Text>
            </TouchableOpacity>
            <Text style={styles.footerVersion}>Tap-N-Eat v1.0.1</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
  headerSection: { alignItems: 'center', marginBottom: 28 },
  logoImage: { width: 180, height: 70, marginBottom: 20 },
  badgeWrap: { backgroundColor: COLORS.primaryLight, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 16 },
  badge: { color: COLORS.primaryDark, fontWeight: '800', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: 10, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },
  toggleRow: { flexDirection: 'row', marginBottom: 24, borderRadius: 12, overflow: 'hidden', backgroundColor: '#F1F5F9', padding: 4 },
  toggleBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: COLORS.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  toggleText: { fontWeight: '700', fontSize: 15, color: COLORS.textMuted },
  toggleTextActive: { color: COLORS.text },
  card: { 
    backgroundColor: COLORS.surface, 
    borderRadius: 24, 
    padding: 28, 
    shadowColor: '#64748B', 
    shadowOffset: { width: 0, height: 8 }, 
    shadowOpacity: 0.08, 
    shadowRadius: 24, 
    elevation: 6 
  },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  input: { 
    borderWidth: 1.5, 
    borderColor: COLORS.border, 
    borderRadius: 12, 
    paddingHorizontal: 16, 
    paddingVertical: Platform.OS === 'ios' ? 16 : 12, 
    fontSize: 16, 
    color: COLORS.text, 
    backgroundColor: '#F8FAFC' 
  },
  errorBox: { backgroundColor: COLORS.dangerLight, borderRadius: 10, padding: 14, marginTop: 16 },
  errorText: { color: COLORS.danger, fontSize: 14, fontWeight: '600' },
  loginBtn: { 
    backgroundColor: COLORS.primary, 
    borderRadius: 14, 
    paddingVertical: 18, 
    alignItems: 'center', 
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnDisabled: { opacity: 0.5, shadowOpacity: 0, elevation: 0 },
  loginBtnText: { color: '#ffffff', fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
  signupNote: { textAlign: 'center', color: COLORS.textLight, fontSize: 12, marginTop: 16, lineHeight: 18 },
  footerSection: { alignItems: 'center', marginTop: 32, paddingTop: 24, borderTopWidth: 1, borderTopColor: COLORS.border },
  footerPowered: { textAlign: 'center', color: COLORS.textMuted, fontSize: 11, marginBottom: 8, lineHeight: 16, fontWeight: '500' },
  privacyLink: { color: COLORS.primary, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline', marginBottom: 12 },
  footerVersion: { textAlign: 'center', color: COLORS.textLight, fontSize: 12, fontWeight: '500' },
});
