import 'package:flutter_test/flutter_test.dart';
import 'package:ham_watch/screens/login_screen.dart';

void main() {
  String n(String full, {String? cc}) =>
      normaliseE164(full, dialCode: cc);

  group('phone typed against a country picker', () {
    test('national part only — the intended path', () {
      expect(n('+256775200442', cc: '+256'), '+256775200442');
    });

    test('leading trunk zero is dropped', () {
      expect(n('+2560775200442', cc: '+256'), '+256775200442');
    });

    // The regression: typing the number as it is printed everywhere.
    test('country code typed on top of the picker is not doubled', () {
      expect(n('+256+256775200442', cc: '+256'), '+256775200442');
    });

    test('doubled code AND a trunk zero together', () {
      expect(n('+256+2560775200442', cc: '+256'), '+256775200442');
    });

    test('spaces and dashes are ignored', () {
      expect(n('+256 775-200 442', cc: '+256'), '+256775200442');
    });

    test('a different country is unaffected', () {
      expect(n('+14155550123', cc: '+1'), '+14155550123');
      expect(n('+1+14155550123', cc: '+1'), '+14155550123');
    });

    test('a number that merely starts with its own code survives', () {
      // +256 256… is a legitimate national number beginning "256".
      expect(n('+256256775442', cc: '+256'), '+256256775442');
    });
  });
}
