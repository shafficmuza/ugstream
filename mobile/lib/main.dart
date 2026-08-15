import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/auth.dart';
import 'services/downloads.dart';
import 'core/branding.dart';
import 'core/config.dart';
import 'screens/login_screen.dart';
import 'screens/set_pin_screen.dart';
import 'screens/shell.dart';
import 'screens/title_screen.dart';

void main() => runApp(const HamWatchApp());

/// Lets a tapped notification navigate from outside the widget tree.
final navigatorKey = GlobalKey<NavigatorState>();

const kAccent = Color(0xFFE50914);
const kBg = Color(0xFF0B0B0B);

class HamWatchApp extends StatelessWidget {
  const HamWatchApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => Auth()),
        // App name/logo/tagline come from the admin-editable DB settings —
        // never hardcoded, so a rename in the dashboard reaches the app.
        ChangeNotifierProvider(create: (ctx) => Branding(ctx.read<Auth>().api)),
        ChangeNotifierProvider(create: (ctx) => DownloadsStore(ctx.read<Auth>().api)..load()),
      ],
      child: MaterialApp(
        title: AppConfig.appName,
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          brightness: Brightness.dark,
          scaffoldBackgroundColor: kBg,
          colorScheme: const ColorScheme.dark(
            primary: kAccent,
            surface: kBg,
          ),
          appBarTheme: const AppBarTheme(backgroundColor: kBg, elevation: 0),
          filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(backgroundColor: kAccent, foregroundColor: Colors.white),
          ),
        ),
        navigatorKey: navigatorKey,
        home: const _Gate(),
      ),
    );
  }
}

/// Routes between splash / login / the main shell based on auth state, and
/// owns notification deep-linking.
class _Gate extends StatefulWidget {
  const _Gate();
  @override
  State<_Gate> createState() => _GateState();
}

class _GateState extends State<_Gate> {
  bool _wired = false;

  /// Handles the `path` the backend puts in the notification payload.
  /// Currently "/title/<slug>"; anything unrecognised just opens the app.
  void _openPath(String path) {
    final parts = path.split('/').where((p) => p.isNotEmpty).toList();
    if (parts.length >= 2 && parts[0] == 'title') {
      navigatorKey.currentState?.push(
        MaterialPageRoute(builder: (_) => TitleScreen(slug: parts[1], name: '')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<Auth>();
    if (auth.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator(color: kAccent)));
    }
    // A stored session we could not reach the server to confirm. Offer a
    // retry rather than the sign-in screen: the account is fine, the network
    // is not, and a sign-in prompt here is what makes the app feel like it
    // logs people out on its own.
    if (!auth.isLoggedIn && auth.sessionUnavailable) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.wifi_off, color: Colors.white38, size: 48),
                const SizedBox(height: 16),
                const Text(
                  'Can’t reach Muza Watch',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                const Text(
                  'You’re still signed in — check your connection and try again.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white54, fontSize: 14, height: 1.4),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: kAccent),
                  onPressed: () => auth.retrySession(),
                  child: const Text('Try again'),
                ),
                const SizedBox(height: 8),
                // Always leave a route into the app. An offline screen whose
                // only action is "try again" is a dead end when the retry
                // cannot succeed.
                TextButton(
                  onPressed: () => auth.signInInstead(),
                  child: const Text('Sign in instead', style: TextStyle(color: Colors.white70)),
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (!auth.isLoggedIn) return const LoginScreen();
    // Signed in, but no PIN yet — the one moment they are certainly paying
    // attention, and the only chance to make the next sign-in cost nothing.
    if (auth.promptForPin) return const SetPinScreen();

    if (!_wired) {
      _wired = true;
      auth.push.onOpenPath = _openPath;
      // A notification that launched the app cold was captured before any
      // navigator existed; replay it now that one does.
      final pending = auth.push.pendingPath;
      if (pending != null) {
        auth.push.pendingPath = null;
        WidgetsBinding.instance.addPostFrameCallback((_) => _openPath(pending));
      }
    }
    return const Shell();
  }
}
