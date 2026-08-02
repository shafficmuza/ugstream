import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/auth.dart';
import 'core/config.dart';
import 'screens/login_screen.dart';
import 'screens/shell.dart';

void main() => runApp(const HamWatchApp());

const kAccent = Color(0xFFE50914);
const kBg = Color(0xFF0B0B0B);

class HamWatchApp extends StatelessWidget {
  const HamWatchApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => Auth(),
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
        home: const _Gate(),
      ),
    );
  }
}

/// Routes between splash / login / the main shell based on auth state.
class _Gate extends StatelessWidget {
  const _Gate();
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<Auth>();
    if (auth.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator(color: kAccent)));
    }
    return auth.isLoggedIn ? const Shell() : const LoginScreen();
  }
}
