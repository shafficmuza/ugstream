import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/auth.dart';
import 'core/branding.dart';
import 'core/config.dart';
import 'screens/login_screen.dart';
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
    if (!auth.isLoggedIn) return const LoginScreen();

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
