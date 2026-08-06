import 'dart:ui' show PlatformDispatcher;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl_phone_field/intl_phone_field.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../core/branding.dart';

/// Phone + OTP login. Two steps: enter phone → enter the code.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  /// E.164, assembled from the selected country and what was typed.
  String? _fullPhone;
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

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

  Future<void> _sendCode() async {
    final phone = _e164;
    if (phone == null || phone.length < 8) {
      setState(() => _error = 'Enter your phone number.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<Auth>().requestOtp(phone);
      setState(() => _codeSent = true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final phone = _e164;
    if (phone == null) return;
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<Auth>().verifyOtp(phone, _code.text.trim());
      // _Gate rebuilds to the shell automatically.
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
                  enabled: !_codeSent,
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
                if (_codeSent) ...[
                  const SizedBox(height: 14),
                  TextField(
                    controller: _code,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Verification code', border: OutlineInputBorder()),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : (_codeSent ? _verify : _sendCode),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    child: Text(_busy ? 'Please wait…' : (_codeSent ? 'Verify & sign in' : 'Send code')),
                  ),
                ),
                if (_codeSent)
                  TextButton(
                    onPressed: _busy ? null : () => setState(() => _codeSent = false),
                    child: const Text('Change number'),
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
