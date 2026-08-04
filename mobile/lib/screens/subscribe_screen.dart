import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/payments.dart';

class SubscribeScreen extends StatefulWidget {
  const SubscribeScreen({super.key});
  @override
  State<SubscribeScreen> createState() => _SubscribeScreenState();
}

class _SubscribeScreenState extends State<SubscribeScreen> {
  late final PaymentService _pay;
  final _phone = TextEditingController();
  Future<(List<Plan>, List<PayMethod>)>? _future;
  String? _waitingMsg; // shown while polling a phone-approval payment

  @override
  void initState() {
    super.initState();
    _pay = PaymentService(context.read<Auth>().api);
    _phone.text = context.read<Auth>().user?.phone ?? '';
    _future = _load();
  }

  Future<(List<Plan>, List<PayMethod>)> _load() async {
    final plans = await _pay.plans();
    final methods = await _pay.methods();
    return (plans, methods);
  }

  PayMethod? _method(List<PayMethod> m, String type) {
    for (final x in m) {
      if (x.method == type) return x;
    }
    return null;
  }

  Future<void> _payMobileMoney(Plan plan) async {
    if (_phone.text.trim().isEmpty) {
      _snack('Enter the mobile money number.');
      return;
    }
    try {
      final res = await _pay.checkout(purpose: 'subscription', planId: plan.id, method: 'mobile_money', payerPhone: _phone.text.trim());
      if (res.actionType == 'redirect' && (res.actionUrl ?? res.checkoutUrl) != null) {
        await _openUrl(res.actionUrl ?? res.checkoutUrl!);
        _pollThenClose(res.paymentId);
        return;
      }
      // phone_prompt → poll
      setState(() => _waitingMsg = 'Approve the payment on $_phoneText — enter your Mobile Money PIN.');
      _pollThenClose(res.paymentId);
    } catch (e) {
      _snack(e.toString());
    }
  }

  Future<void> _payCard(Plan plan) async {
    try {
      final res = await _pay.checkout(purpose: 'subscription', planId: plan.id, method: 'card');
      final url = res.actionUrl ?? res.checkoutUrl;
      if (url != null) {
        await _openUrl(url);
        _pollThenClose(res.paymentId);
      }
    } catch (e) {
      _snack(e.toString());
    }
  }

  void _pollThenClose(String paymentId) {
    int attempts = 0;
    Timer.periodic(const Duration(seconds: 2), (timer) async {
      attempts++;
      String status = 'pending';
      try {
        status = await _pay.status(paymentId);
      } catch (_) {}
      if (status == 'successful') {
        timer.cancel();
        await context.read<Auth>().refreshMe();
        if (mounted) {
          setState(() => _waitingMsg = null);
          _snack('Payment confirmed. Enjoy!');
          Navigator.of(context).maybePop();
        }
      } else if (status == 'failed' || attempts > 60) {
        timer.cancel();
        if (mounted) setState(() => _waitingMsg = 'Payment was not completed. Try again.');
      }
    });
  }

  String get _phoneText => _phone.text.trim();
  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  /// Open a hosted payment page. Deliberately does NOT gate on
  /// canLaunchUrl(): on Android 11+ that returns false unless the target
  /// intent is declared in the manifest, which made card payments silently
  /// do nothing. Try to launch, fall back to an in-app browser, and surface
  /// a real error instead of failing quietly.
  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (ok) return;
    } catch (_) {
      // fall through to the in-app browser
    }
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
      if (ok) return;
    } catch (_) {
      // fall through to the error below
    }
    if (mounted) {
      _snack('Could not open the payment page. Check you have a browser installed.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose a plan')),
      body: _waitingMsg != null
          ? _WaitingView(message: _waitingMsg!, onCancel: () => setState(() => _waitingMsg = null))
          : FutureBuilder<(List<Plan>, List<PayMethod>)>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)));
                }
                if (snap.hasError) return const Center(child: Text('Could not load plans.'));
                final (plans, methods) = snap.data!;
                final mm = _method(methods, 'mobile_money');
                final card = _method(methods, 'card');
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (mm == null || mm.enabled) ...[
                      const Text('Mobile money number', style: TextStyle(color: Colors.white70)),
                      const SizedBox(height: 6),
                      TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(hintText: 'e.g. 0772123456')),
                      const SizedBox(height: 16),
                    ],
                    for (final p in plans)
                      Card(
                        color: const Color(0xFF141414),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                                    Text('${p.durationDays} days', style: const TextStyle(color: Colors.white54, fontSize: 13)),
                                  ]),
                                  Text('UGX ${p.priceUgx}', style: const TextStyle(fontWeight: FontWeight.w800)),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Row(children: [
                                if (mm == null || mm.enabled)
                                  Expanded(child: FilledButton(onPressed: () => _payMobileMoney(p), child: Text(mm?.label ?? 'Mobile Money'))),
                                if ((mm == null || mm.enabled) && (card == null || card.enabled)) const SizedBox(width: 10),
                                if (card == null || card.enabled)
                                  Expanded(child: OutlinedButton(onPressed: () => _payCard(p), child: const Text('Card'))),
                              ]),
                            ],
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
    );
  }
}

class _WaitingView extends StatelessWidget {
  const _WaitingView({required this.message, required this.onCancel});
  final String message;
  final VoidCallback onCancel;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.phone_android, size: 48, color: Color(0xFFE50914)),
            const SizedBox(height: 16),
            const Text('Check your phone', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
            const SizedBox(height: 20),
            const CircularProgressIndicator(color: Color(0xFFE50914)),
            const SizedBox(height: 20),
            TextButton(onPressed: onCancel, child: const Text('Cancel')),
          ],
        ),
      ),
    );
  }
}
