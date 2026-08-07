import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';

/// Offered once, immediately after a code sign-in by someone with no PIN yet.
///
/// It sits here rather than on the sign-in screen because the gate rebuilds
/// past that screen the moment tokens land — and here is better anyway: the
/// user is already in, so skipping costs them nothing and the prompt cannot
/// stand between them and their account.
class SetPinScreen extends StatefulWidget {
  const SetPinScreen({super.key});
  @override
  State<SetPinScreen> createState() => _SetPinScreenState();
}

class _SetPinScreenState extends State<SetPinScreen> {
  final _pin = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    if (_pin.text.trim() != _confirm.text.trim()) {
      setState(() => _error = 'The two PINs do not match.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = context.read<Auth>();
      await auth.setPin(_pin.text.trim());
      auth.dismissPinPrompt();
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
                const Text('Set a PIN',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                const Text(
                  'Choose a PIN and you can sign in with it next time — no waiting for a text. '
                  'You can change it later, and you can always get a code by SMS instead.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70, fontSize: 14, height: 1.45),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _pin,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  autofocus: true,
                  decoration: const InputDecoration(
                      labelText: 'New PIN (4–8 digits)', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _confirm,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  decoration: const InputDecoration(
                      labelText: 'Confirm PIN', border: OutlineInputBorder()),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!,
                      style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _save,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    child: Text(_busy ? 'Saving…' : 'Save PIN'),
                  ),
                ),
                TextButton(
                  onPressed: _busy ? null : () => context.read<Auth>().dismissPinPrompt(),
                  child: const Text('Skip for now'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
