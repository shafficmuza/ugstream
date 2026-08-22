import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';

/// Deleting your account, for good.
///
/// Required by App Store guideline 5.1.1(v): an app that lets people make an
/// account has to let them destroy it from inside the app. A support email
/// does not satisfy it, and neither does a line in the privacy policy.
///
/// Two things this screen has to get right beyond simply working. It must say
/// what will be lost *before* the irreversible tap, in specifics rather than
/// in the abstract — above all that an active subscription is not refunded and
/// nothing is cancelled at the telco. And confirmation has to cost something:
/// a plain Yes/No dialog on a destructive, unrecoverable action is too easy to
/// dismiss by reflex, so the word DELETE is typed out.
class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _confirm = TextEditingController();
  Map<String, dynamic>? _summary;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  static const _keyword = 'DELETE';

  @override
  void initState() {
    super.initState();
    _loadSummary();
  }

  @override
  void dispose() {
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _loadSummary() async {
    try {
      final s = await context.read<Auth>().deletionSummary();
      if (mounted) setState(() { _summary = s; _loading = false; });
    } catch (_) {
      // Never a reason to block the deletion: the summary makes the warning
      // specific, and someone who came here to leave should not be held up by
      // a failed count.
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _delete() async {
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<Auth>().deleteAccount();
      // Auth notifies its listeners, so the app returns to the sign-in screen
      // on its own; this screen just gets out of the way.
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _error = 'Could not delete your account. $e'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final canDelete = _confirm.text.trim().toUpperCase() == _keyword && !_busy;
    final until = _summary?['activeSubscriptionUntil'] as String?;

    return Scaffold(
      appBar: AppBar(title: const Text('Delete account')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)))
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              children: [
                const Text(
                  'This cannot be undone.',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 10),
                const Text(
                  'Your account and everything in it is removed immediately. '
                  'There is no waiting period and no way to get it back.',
                  style: TextStyle(color: Colors.white70, height: 1.5),
                ),
                const SizedBox(height: 22),

                // Named, not summarised: "your data" tells nobody anything.
                _section('What is deleted', [
                  'Your phone number and profile details',
                  if ((_summary?['watchHistoryCount'] ?? 0) > 0)
                    'Everything you have watched (${_summary!['watchHistoryCount']} titles)'
                  else
                    'Everything you have watched',
                  if ((_summary?['myListCount'] ?? 0) > 0)
                    'My List (${_summary!['myListCount']} saved)'
                  else
                    'My List',
                  if ((_summary?['signedInDevices'] ?? 0) > 0)
                    'Sign-in on ${_summary!['signedInDevices']} device(s) — all signed out'
                  else
                    'Every signed-in device',
                  'Downloads on this phone stop working',
                ]),

                // The part people are actually harmed by not knowing.
                if (until != null) ...[
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0x33E50914),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0x66E50914)),
                    ),
                    child: Text(
                      'You have an active subscription until '
                      '${until.split('T').first}. Deleting your account does not '
                      'refund it, and does not cancel any mobile-money arrangement '
                      'with your provider — cancel that with them separately.',
                      style: const TextStyle(color: Colors.white, height: 1.45, fontSize: 13.5),
                    ),
                  ),
                ],

                const SizedBox(height: 18),
                _section('What we keep', [
                  'Records of payments you have made, because we are required '
                      'to keep them. They are no longer linked to you or your number.',
                ]),

                const SizedBox(height: 8),
                const Text(
                  'Your phone number is released, so you can sign up again later '
                  'as a new account.',
                  style: TextStyle(color: Colors.white54, fontSize: 13, height: 1.45),
                ),

                const SizedBox(height: 26),
                const Text('Type $_keyword to confirm',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                TextField(
                  controller: _confirm,
                  onChanged: (_) => setState(() {}),
                  autocorrect: false,
                  enableSuggestions: false,
                  textCapitalization: TextCapitalization.characters,
                  decoration: InputDecoration(
                    hintText: _keyword,
                    filled: true,
                    fillColor: const Color(0xFF1C1C1E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),

                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                ],

                const SizedBox(height: 18),
                SizedBox(
                  height: 50,
                  child: FilledButton(
                    onPressed: canDelete ? _delete : null,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFE50914),
                      disabledBackgroundColor: const Color(0xFF3A2023),
                    ),
                    child: _busy
                        ? const SizedBox(
                            width: 20, height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Delete my account permanently'),
                  ),
                ),
                const SizedBox(height: 10),
                Center(
                  child: TextButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: const Text('Keep my account'),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _section(String heading, List<String> lines) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(heading, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
        const SizedBox(height: 8),
        for (final l in lines)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 7, right: 9),
                  child: SizedBox(
                    width: 4, height: 4,
                    child: DecoratedBox(decoration: BoxDecoration(
                        color: Colors.white38, shape: BoxShape.circle)),
                  ),
                ),
                Expanded(
                  child: Text(l,
                      style: const TextStyle(color: Colors.white70, height: 1.45, fontSize: 13.5)),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
