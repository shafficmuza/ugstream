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
          ListTile(
            leading: const Icon(Icons.card_membership),
            title: const Text('Subscribe / manage plan'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SubscribeScreen())),
          ),
          // Push state, surfaced because a store build cannot be attached to a
          // debugger: without this, a handset that fails to register is
          // invisible from both ends.
          ListTile(
            leading: Icon(
              context.read<Auth>().push.hasToken
                  ? Icons.notifications_active
                  : Icons.notifications_off,
              color: context.read<Auth>().push.hasToken ? Colors.greenAccent : Colors.orangeAccent,
            ),
            title: const Text('Notifications'),
            subtitle: Text(
              context.read<Auth>().push.status,
              style: const TextStyle(fontSize: 12, color: Colors.white54),
            ),
            trailing: IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Retry registration',
              onPressed: () async {
                await context.read<Auth>().push.onSignedIn();
                if (context.mounted) setState(() {});
              },
            ),
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
