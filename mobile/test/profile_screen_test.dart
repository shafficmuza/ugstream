import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ham_watch/core/app_version.dart';
import 'package:ham_watch/core/branding.dart';
import 'package:ham_watch/screens/profile_screen.dart';
import 'package:package_info_plus/package_info_plus.dart';

Widget _host(Widget child) => MaterialApp(
      theme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

void main() {
  group('SupportContacts', () {
    test('parses the /settings shape', () {
      final s = SupportContacts.fromSettings({
        'appName': 'Muza Watch',
        'supportEmail': ' help@muzawatch.com ',
        'supportPhone': '+256 775 200 443',
        'supportWhatsapp': '+256775200443',
        'supportHours': 'Mon–Sat, 9am–8pm EAT',
      });
      expect(s.email, 'help@muzawatch.com');
      expect(s.phone, '+256 775 200 443');
      expect(s.whatsapp, '+256775200443');
      expect(s.hours, 'Mon–Sat, 9am–8pm EAT');
      expect(s.hasAnyChannel, isTrue);
    });

    test('blank and missing fields are both "not configured"', () {
      final s = SupportContacts.fromSettings({'supportEmail': '', 'supportPhone': '   '});
      expect(s.email, isNull);
      expect(s.phone, isNull);
      expect(s.whatsapp, isNull);
      expect(s.hasAnyChannel, isFalse);
      expect(SupportContacts.none.hasAnyChannel, isFalse);
    });

    test('whatsappDigits strips +, spaces and dashes', () {
      expect(
        SupportContacts.fromSettings({'supportWhatsapp': '+256 775-200-443'}).whatsappDigits,
        '256775200443',
      );
      expect(SupportContacts.fromSettings({'supportWhatsapp': 'call us'}).whatsappDigits, isNull);
    });
  });

  group('SupportSection', () {
    const configured = SupportContacts(
      email: 'help@muzawatch.com',
      phone: '+256775200443',
      whatsapp: '+256775200443',
      hours: 'Mon–Sat, 9am–8pm EAT',
    );

    testWidgets('shows a row per configured channel, plus the hours caption', (tester) async {
      await tester.pumpWidget(_host(const SupportSection(
        contacts: configured,
        appName: 'Muza Watch',
        userPhone: '+256775200442',
        appVersion: '1.5.3 (17)',
      )));

      expect(find.text('HELP & SUPPORT'), findsOneWidget);
      expect(find.text('WhatsApp'), findsOneWidget);
      expect(find.text('Email us'), findsOneWidget);
      expect(find.text('Call us'), findsOneWidget);
      expect(find.text('help@muzawatch.com'), findsOneWidget);
      expect(find.text('Mon–Sat, 9am–8pm EAT'), findsOneWidget);
    });

    testWidgets('omits channels the admin has not configured', (tester) async {
      await tester.pumpWidget(_host(const SupportSection(
        contacts: SupportContacts(whatsapp: '+256775200443'),
        appName: 'Muza Watch',
      )));

      expect(find.text('WhatsApp'), findsOneWidget);
      expect(find.text('Email us'), findsNothing);
      expect(find.text('Call us'), findsNothing);
    });

    testWidgets('falls back to one retry row when nothing is configured', (tester) async {
      var retried = 0;
      await tester.pumpWidget(_host(SupportSection(
        contacts: SupportContacts.none,
        appName: 'Muza Watch',
        onRetry: () => retried++,
      )));

      expect(find.text('Contact support'), findsOneWidget);
      expect(find.text('WhatsApp'), findsNothing);
      await tester.tap(find.text('Contact support'));
      expect(retried, 1);
    });
  });

  group('VersionFooter', () {
    testWidgets('renders the installed version', (tester) async {
      await tester.pumpWidget(_host(const VersionFooter(version: '1.5.3 (17)')));
      expect(find.text('Version 1.5.3 (17)'), findsOneWidget);
    });

    testWidgets('holds its height while the version is still loading', (tester) async {
      await tester.pumpWidget(_host(const VersionFooter(version: null)));
      expect(find.text('Version 1.5.3 (17)'), findsNothing);
      expect(tester.getSize(find.byType(VersionFooter)).height, 44);
    });
  });

  group('AppVersion', () {
    testWidgets('formats version and build number from the platform', (tester) async {
      PackageInfo.setMockInitialValues(
        appName: 'Muza Watch',
        packageName: 'com.sentepos.ham_watch',
        version: '1.5.3',
        buildNumber: '17',
        buildSignature: '',
      );
      expect(await AppVersion.load(), '1.5.3 (17)');
    });
  });
}
