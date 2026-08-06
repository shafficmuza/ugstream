import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
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
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  Future<void> _sendCode() async {
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<Auth>().requestOtp(_phone.text.trim());
      setState(() => _codeSent = true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<Auth>().verifyOtp(_phone.text.trim(), _code.text.trim());
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
                TextField(
                  controller: _phone,
                  enabled: !_codeSent,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'Phone number',
                    hintText: 'e.g. 0772123456',
                    helperText: 'Outside Uganda? Include your country code.',
                    helperStyle: TextStyle(color: Colors.white38, fontSize: 11),
                    border: OutlineInputBorder(),
                  ),
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
