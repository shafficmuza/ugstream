import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

/// Whether this build may show any way to purchase a subscription.
///
/// On iOS and in the Play Store bundle the answer is no, permanently.
/// Apple's guideline 3.1.1 requires
/// digital subscriptions to be sold through In-App Purchase, and the Uganda
/// storefront has no link-out exception — App Review rejected build 42 for
/// exactly this. Mobile Money cannot be sold through IAP at all, so the iOS
/// app is a "reader" app under 3.1.3(a), the same arrangement as Netflix:
/// subscribe elsewhere, sign in and watch here.
///
/// This is deliberately not a server-driven flag. A remotely switchable
/// purchase flow on iOS is indistinguishable from hiding it from App Review,
/// which is the fastest way to lose the developer account.

/// Which store this binary is built for: '' (sideloaded APK), 'play'.
/// Set at build time: --dart-define=STORE=play for the Play bundle.
const String _store = String.fromEnvironment('STORE');

bool get purchasesAllowed {
  if (kIsWeb) return true;
  // iOS: never. Apple's 3.1.1, see above.
  if (Platform.isIOS) return false;
  // The Play Store bundle: never, for the same reason with a different
  // landlord — Play's Payments policy requires Google Play Billing for
  // digital subscriptions, and mobile money in-app is a removable offence
  // the moment a reviewer looks. The sideloaded APK from the website is
  // outside any store's rules and keeps the full payment flow.
  if (_store == 'play') return false;
  return true;
}

/// What an un-entitled viewer sees on iOS instead of the subscribe screen.
///
/// The wording is the part App Review actually checks: it may state that
/// purchase is not available in the app, but must not name the website, show
/// a URL, or otherwise direct the viewer to an external way to pay — a
/// "button, external link, or other call to action" is the exact phrase
/// guideline 3.1.1 forbids. Netflix's sign-up screen says no more than this.
void showNotEntitledNotice(BuildContext context) {
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: const Color(0xFF141414),
      title: const Text('Subscription needed'),
      content: const Text(
        'This title needs an active Muza Watch subscription.\n\n'
        'Subscriptions cannot be purchased in the app.',
        style: TextStyle(color: Colors.white70, height: 1.4),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('OK')),
      ],
    ),
  );
}
