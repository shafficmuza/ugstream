import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import 'subscribe_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  bool _busy = false;
  String? _msg;

  @override
  void initState() {
    super.initState();
    final u = context.read<Auth>().user;
    _name.text = u?.displayName ?? '';
    _email.text = u?.email ?? '';
    _address.text = u?.address ?? '';
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _msg = 'Name is required.');
      return;
    }
    setState(() { _busy = true; _msg = null; });
    try {
      await context.read<Auth>().updateProfile(
            displayName: _name.text.trim(), email: _email.text.trim(), address: _address.text.trim());
      setState(() => _msg = 'Saved.');
    } catch (e) {
      setState(() => _msg = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  /// Set or change the PIN. Changing asks for the current one, so a phone left
  /// unattended for a moment cannot be used to lock its owner out.
  Future<void> _editPin(BuildContext context, {required bool hasPin}) async {
    final current = TextEditingController();
    final next = TextEditingController();
    final confirm = TextEditingController();
    String? error;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(hasPin ? 'Change your PIN' : 'Set a PIN'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hasPin)
                TextField(
                  controller: current,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Current PIN'),
                ),
              TextField(
                controller: next,
                obscureText: true,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'New PIN (4–8 digits)'),
              ),
              TextField(
                controller: confirm,
                obscureText: true,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Confirm new PIN'),
              ),
              if (error != null) ...[
                const SizedBox(height: 10),
                Text(error!, style: const TextStyle(color: Colors.redAccent, fontSize: 12.5)),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                if (next.text.trim() != confirm.text.trim()) {
                  setDialogState(() => error = 'The two PINs do not match.');
                  return;
                }
                try {
                  await context.read<Auth>().setPin(
                        next.text.trim(),
                        currentPin: hasPin ? current.text.trim() : null,
                      );
                  if (dialogContext.mounted) Navigator.of(dialogContext).pop();
                } catch (e) {
                  setDialogState(() => error = e.toString());
                }
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _removePin(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove your PIN?'),
        content: const Text(
            'You will go back to receiving a code by SMS each time you sign in.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (ok == true && context.mounted) await context.read<Auth>().clearPin();
  }

  @override
  Widget build(BuildContext context) {
    final u = context.watch<Auth>().user;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(child: CircleAvatar(radius: 34, backgroundColor: const Color(0xFF1A1A1A), child: Text((u?.displayName ?? u?.phone ?? '?').substring(0, 1).toUpperCase(), style: const TextStyle(fontSize: 28)))),
          const SizedBox(height: 8),
          Center(child: Text(u?.phone ?? '', style: const TextStyle(color: Colors.white54))),
          const SizedBox(height: 24),
          const Text('Name *', style: TextStyle(color: Colors.white70)),
          TextField(controller: _name, decoration: const InputDecoration(hintText: 'Your name')),
          const SizedBox(height: 14),
          const Text('Email (optional)', style: TextStyle(color: Colors.white70)),
          TextField(controller: _email, keyboardType: TextInputType.emailAddress),
          const SizedBox(height: 14),
          const Text('Address (optional)', style: TextStyle(color: Colors.white70)),
          TextField(controller: _address),
          if (_msg != null) ...[const SizedBox(height: 10), Text(_msg!, style: const TextStyle(color: Colors.white70))],
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save')),
          const Divider(height: 40),
          // The PIN is what keeps a returning sign-in free, so changing and
          // removing it both live in plain sight rather than buried.
          ListTile(
            leading: Icon(u?.pinSet == true ? Icons.pin : Icons.pin_outlined),
            title: Text(u?.pinSet == true ? 'Change sign-in PIN' : 'Set a sign-in PIN'),
            subtitle: Text(
              u?.pinSet == true
                  ? 'You sign in with your PIN instead of waiting for a text.'
                  : 'Sign in without waiting for a text message.',
              style: const TextStyle(fontSize: 12, color: Colors.white54),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _editPin(context, hasPin: u?.pinSet == true),
          ),
          if (u?.pinSet == true)
            ListTile(
              leading: const Icon(Icons.lock_open, color: Colors.orangeAccent),
              title: const Text('Remove PIN'),
              subtitle: const Text('Go back to a code by SMS each time you sign in.',
                  style: TextStyle(fontSize: 12, color: Colors.white54)),
              onTap: () => _removePin(context),
            ),
          ListTile(
            leading: const Icon(Icons.card_membership),
            title: const Text('Subscribe / manage plan'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SubscribeScreen())),
          ),
          // Push state, surfaced because a store build cannot be attached to a
          // debugger: without this, a handset that fails to register is
          // invisible from both ends.
          ValueListenableBuilder<String>(
            valueListenable: context.read<Auth>().push.statusNotifier,
            builder: (context, status, _) {
              final ok = context.read<Auth>().push.hasToken;
              return ListTile(
                leading: Icon(
                  ok ? Icons.notifications_active : Icons.notifications_off,
                  color: ok ? Colors.greenAccent : Colors.orangeAccent,
                ),
                title: const Text('Notifications'),
                subtitle: Text(
                  status,
                  style: const TextStyle(fontSize: 12, color: Colors.white54),
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.refresh),
                  tooltip: 'Retry registration',
                  onPressed: () => context.read<Auth>().push.onSignedIn(),
                ),
              );
            },
          ),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.redAccent),
            title: const Text('Log out', style: TextStyle(color: Colors.redAccent)),
            onTap: () => context.read<Auth>().logout(),
          ),
        ],
      ),
    );
  }
}
