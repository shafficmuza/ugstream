import 'dart:ui' show PlatformDispatcher;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl_phone_field/intl_phone_field.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../core/branding.dart';

/// Sign-in. From the phone number the server says which step to show: a user
/// who has set a PIN goes straight to it and no message is sent, which is what
/// keeps an OTP a once-per-account cost rather than once per sign-in.
/// Which field the sign-in screen is showing.
enum _Step { phone, code, pin }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _pin = TextEditingController();
  /// E.164, assembled from the selected country and what was typed.
  String? _fullPhone;
  _Step _step = _Step.phone;
  bool _busy = false;
  String? _error;

  bool get _onPhoneStep => _step == _Step.phone;

  /// Default the picker to where the handset actually is rather than assuming
  /// Uganda — a subscriber in London should not have to hunt for their own
  /// country every time they sign in. Falls back to UG, the home market.
  String get _initialCountry {
    try {
      final locale = PlatformDispatcher.instance.locale;
      final region = locale.countryCode;
      if (region != null && region.length == 2) return region.toUpperCase();
    } catch (_) {
      // Platform locale unavailable — the fallback below is fine.
    }
    return 'UG';
  }

  /// The number to send. Strips a national trunk zero, which people type out
  /// of habit and which would otherwise duplicate the country code
  /// (+256 + 0772… = +2560772…, not a number).
  String? get _e164 {
    final full = _fullPhone;
    if (full == null) return null;
    final normalised = full.replaceAll(RegExp(r'[^\d+]'), '');
    final m = RegExp(r'^\+(\d{1,3})0(\d+)$').firstMatch(normalised);
    return m != null ? '+${m.group(1)}${m.group(2)}' : normalised;
  }

  /// From the phone step: ask which way this number signs in, then either show
  /// the PIN field or send a code.
  Future<void> _continue() async {
    final phone = _e164;
    if (phone == null || phone.length < 8) {
      setState(() => _error = 'Enter your phone number.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    // Read once, up front: two awaits follow, and reaching back into the
    // context after either is what the analyzer objects to.
    final auth = context.read<Auth>();
    try {
      final method = await auth.signInMethod(phone);
      if (method == 'pin') {
        setState(() => _step = _Step.pin);
        return;
      }
      await auth.requestOtp(phone);
      setState(() => _step = _Step.code);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Send a code regardless — the way back in when a PIN is forgotten.
  Future<void> _sendCode() async {
    final phone = _e164;
    if (phone == null || phone.length < 8) {
      setState(() => _error = 'Enter your phone number.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<Auth>().requestOtp(phone);
      setState(() => _step = _Step.code);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final phone = _e164;
    if (phone == null) return;
    setState(() { _busy = true; _error = null; });
    try {
      // On success the gate rebuilds past this screen — including, for a user
      // with no PIN yet, to the prompt to set one.
      await context.read<Auth>().verifyOtp(phone, _code.text.trim());
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signInWithPin() async {
    final phone = _e164;
    if (phone == null) return;
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<Auth>().loginWithPin(phone, _pin.text.trim());
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Builder(builder: (context) {
                  final branding = context.watch<Branding>();
                  return Column(children: [
                    if (branding.logoUrl != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: CachedNetworkImage(imageUrl: branding.logoUrl!, height: 44),
                      ),
                    Text(branding.appName.toUpperCase(),
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Color(0xFFE50914), fontSize: 30, fontWeight: FontWeight.w900, letterSpacing: 1)),
                    if (branding.tagline != null) ...[
                      const SizedBox(height: 4),
                      Text(branding.tagline!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white54, fontSize: 13)),
                    ],
                  ]);
                }),
                const SizedBox(height: 8),
                const Text('Sign in with your phone number',
                    textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
                const SizedBox(height: 28),
                IntlPhoneField(
                  controller: _phone,
                  enabled: _onPhoneStep,
                  initialCountryCode: _initialCountry,
                  showCountryFlag: true,
                  // The picker supplies the dialling code, so the number field
                  // holds the national part only.
                  disableLengthCheck: false,
                  invalidNumberMessage: 'That number doesn\'t look right',
                  style: const TextStyle(color: Colors.white),
                  dropdownTextStyle: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Phone number',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (phone) => _fullPhone = phone.completeNumber,
                  onCountryChanged: (_) => _fullPhone = null,
                ),
                if (_step == _Step.code) ...[
                  const SizedBox(height: 14),
                  TextField(
                    controller: _code,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Verification code', border: OutlineInputBorder()),
                  ),
                ],
                if (_step == _Step.pin) ...[
                  const SizedBox(height: 14),
                  TextField(
                    controller: _pin,
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Your PIN', border: OutlineInputBorder()),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy
                      ? null
                      : switch (_step) {
                          _Step.phone => _continue,
                          _Step.code => _verify,
                          _Step.pin => _signInWithPin,
                        },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    child: Text(_busy
                        ? 'Please wait…'
                        : switch (_step) {
                            _Step.phone => 'Continue',
                            _Step.code => 'Verify & sign in',
                            _Step.pin => 'Sign in',
                          }),
                  ),
                ),
                if (_step == _Step.pin)
                  // A forgotten PIN must never be a lost account. It costs a
                  // message, which is why it is a quiet link and not a button.
                  TextButton(
                    onPressed: _busy ? null : _sendCode,
                    child: const Text('Forgot your PIN? Get a code by SMS'),
                  ),
                if (_step != _Step.phone)
                  TextButton(
                    onPressed: _busy ? null : () => setState(() => _step = _Step.phone),
                    child: const Text('Change number'),
                  )
                else
                  // For someone who already holds a code — read out by support,
                  // or an SMS that arrived after the app was reopened. Without
                  // this the only way to the entry field is a fresh request,
                  // which the cooldown can refuse.
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () {
                            if (_e164 == null) {
                              setState(() => _error = 'Enter your phone number first.');
                              return;
                            }
                            setState(() {
                              _error = null;
                              _step = _Step.code;
                            });
                          },
                    child: const Text('I already have a code'),
                  ),
                const SizedBox(height: 8),
                Text(context.watch<Branding>().appName,
                    textAlign: TextAlign.center, style: const TextStyle(color: Colors.white24, fontSize: 12)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
